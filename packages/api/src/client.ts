import type { ExecutionContext } from 'hono'

import { requireBrokerApiKey } from './oauth/config'

const allowedMethods = ['GET', 'POST', 'DELETE'] as const
type AllowedMethod = (typeof allowedMethods)[number]

export const browserApiPath = '/api/client'
export const hookfishApiPath = '/api'

const maxRequestBodyBytes = 65_536

function parseMethod(method: string): AllowedMethod | undefined {
  const normalized = method.toUpperCase()
  return allowedMethods.find((candidate) => candidate === normalized)
}

/** Whether an API operation is safe for the credential-injecting client facade. */
export function isAllowedClientRequest(
  method: string,
  pathname: string,
): boolean {
  const normalizedMethod = parseMethod(method)
  if (!normalizedMethod) return false

  let decodedPathname: string
  try {
    decodedPathname = decodeURIComponent(pathname)
  } catch {
    return false
  }

  if (normalizedMethod === 'GET') {
    return (
      decodedPathname === '/api/stats' ||
      decodedPathname === '/api/oauth/providers' ||
      decodedPathname === '/api/oauth/connections' ||
      decodedPathname.startsWith('/api/oauth/connections/')
    )
  }

  if (normalizedMethod === 'POST') {
    return /^\/api\/oauth\/[^/]+\/authorize$/.test(decodedPathname)
  }

  return (
    decodedPathname.startsWith('/api/oauth/connections/') &&
    decodedPathname.length > '/api/oauth/connections/'.length
  )
}

export const isAllowedBrowserApiRequest = isAllowedClientRequest

export type HealthResponse = {
  ok: true
  runtime: string
  checkedAt: string
}

export type HookfishFetch<Bindings extends object = object> = (
  request: Request,
  bindings?: Bindings,
  executionContext?: ExecutionContext,
) => Response | Promise<Response>

export type BrowserRequestAuthorizer<Bindings extends object> = (
  request: Request,
  bindings: Bindings | undefined,
) => Response | undefined | Promise<Response | undefined>

export type HookfishBackendOptions<Bindings extends object = object> = {
  config: {
    includeClient?: boolean
    trustedOrigins?: readonly string[]
  }
  hookfishFetch: HookfishFetch<Bindings>
  /** Override the configured browser origins for runtime-specific deployments. */
  browserOrigins?:
    | readonly string[]
    | ((bindings: Bindings | undefined) => readonly string[])
  /** Resolve the root or scoped credential used only by the browser facade. */
  brokerApiKey?: string | ((bindings: Bindings | undefined) => string)
  /** Optional application/session authorization before the facade is used. */
  authorizeBrowserRequest?: BrowserRequestAuthorizer<Bindings>
  runtime?: string | ((bindings: Bindings | undefined) => string)
}

export type HookfishBackend<Bindings extends object = object> = {
  fetch(
    request: Request,
    bindings?: Bindings,
    executionContext?: ExecutionContext,
  ): Promise<Response>
}

function jsonError(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

function isApiPath(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

function corsOrigin<Bindings extends object>(
  request: Request,
  bindings: Bindings | undefined,
  configuredOrigins:
    | readonly string[]
    | ((bindings: Bindings | undefined) => readonly string[])
    | undefined,
): string | null | undefined {
  const origin = request.headers.get('Origin')
  if (!origin) return undefined

  const requestOrigin = new URL(request.url).origin
  const origins =
    typeof configuredOrigins === 'function'
      ? configuredOrigins(bindings)
      : (configuredOrigins ?? [])
  return origin === requestOrigin || origins.includes(origin) ? origin : null
}

function addCorsHeaders(
  response: Response,
  origin: string | undefined,
): Response {
  if (!origin) return response

  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', origin)
  headers.append('Vary', 'Origin')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function preflightResponse(origin: string): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    },
  })
}

async function boundedRequestBody(
  request: Request,
): Promise<string | undefined> {
  if (request.method !== 'POST') return undefined

  const contentLength = request.headers.get('Content-Length')
  if (contentLength && Number(contentLength) > maxRequestBodyBytes) {
    throw new RangeError('Hookfish request body is too large')
  }

  const body = await request.text()
  if (new TextEncoder().encode(body).byteLength > maxRequestBodyBytes) {
    throw new RangeError('Hookfish request body is too large')
  }
  return body
}

/** Compose the raw API with the optional browser-safe `/api/client` facade. */
export function createHookfishBackend<Bindings extends object = object>(
  options: HookfishBackendOptions<Bindings>,
): HookfishBackend<Bindings> {
  return {
    async fetch(request, suppliedBindings, executionContext) {
      const url = new URL(request.url)

      if (
        isApiPath(url.pathname, hookfishApiPath) &&
        !isApiPath(url.pathname, browserApiPath)
      ) {
        return options.hookfishFetch(
          request,
          suppliedBindings,
          executionContext,
        )
      }

      if (
        !options.config.includeClient ||
        !isApiPath(url.pathname, browserApiPath)
      ) {
        return new Response('Not Found', { status: 404 })
      }

      const origin = corsOrigin(
        request,
        suppliedBindings,
        options.browserOrigins ?? options.config.trustedOrigins,
      )
      if (origin === null) {
        return jsonError(
          403,
          'untrusted_browser_origin',
          'This browser origin is not allowed to call the Hookfish application API.',
        )
      }

      if (request.method === 'OPTIONS') {
        return origin
          ? preflightResponse(origin)
          : new Response(null, { status: 204 })
      }

      const authorizationFailure = await options.authorizeBrowserRequest?.(
        request.clone(),
        suppliedBindings,
      )
      if (authorizationFailure) {
        return addCorsHeaders(authorizationFailure, origin)
      }

      if (url.pathname === `${browserApiPath}/health`) {
        const runtime =
          typeof options.runtime === 'function'
            ? options.runtime(suppliedBindings)
            : (options.runtime ?? 'fetch')
        return addCorsHeaders(
          Response.json({
            ok: true,
            runtime,
            checkedAt: new Date().toISOString(),
          } satisfies HealthResponse),
          origin,
        )
      }

      const method = parseMethod(request.method)
      const targetPath = `${hookfishApiPath}${url.pathname.slice(browserApiPath.length)}`
      if (!method || !isAllowedClientRequest(method, targetPath)) {
        return addCorsHeaders(
          jsonError(
            403,
            'forbidden_browser_route',
            'This Hookfish route is not available to the browser.',
          ),
          origin,
        )
      }

      let body: string | undefined
      try {
        body = await boundedRequestBody(request)
      } catch (error) {
        if (error instanceof RangeError) {
          return addCorsHeaders(
            jsonError(413, 'request_too_large', error.message),
            origin,
          )
        }
        throw error
      }

      const brokerApiKey =
        typeof options.brokerApiKey === 'function'
          ? options.brokerApiKey(suppliedBindings)
          : (options.brokerApiKey ??
            requireBrokerApiKey(suppliedBindings ?? {}))
      const targetUrl = new URL(request.url)
      targetUrl.pathname = targetPath
      const headers = new Headers({
        Accept: 'application/json',
        Authorization: `Bearer ${brokerApiKey}`,
      })
      if (body !== undefined) headers.set('Content-Type', 'application/json')

      const response = await options.hookfishFetch(
        new Request(targetUrl, { method, headers, body }),
        suppliedBindings,
        executionContext,
      )
      const responseHeaders = new Headers(response.headers)
      responseHeaders.set('Cache-Control', 'no-store')

      return addCorsHeaders(
        new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
        }),
        origin,
      )
    },
  }
}
