import { type Context, type ExecutionContext, Hono } from 'hono'

import {
  type ApplicationAuthProvider,
  type ApplicationAuthResult,
  type ApplicationPrincipal,
  applicationTenantScope,
  normalizeApplicationPrincipal,
  qualifyApplicationNamespace,
  qualifyApplicationPath,
  stripApplicationNamespace,
} from './application-auth.js'
import { mintApplicationAccessToken } from './capability.js'
import { HookfishClientError } from './errors.js'

export const browserApiPath = '/api/client'
export const hookfishApiPath = '/api'

const stateChangingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const sensitiveResponseKeys = new Set([
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'clientsecret',
  'apikey',
  'credential',
  'password',
  'privatekey',
  'authorization',
])

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

export type HookfishBackendOptions<Bindings extends object = object> = {
  config: {
    auth?: ApplicationAuthProvider<Bindings>
    clientOrigins?: readonly string[]
  }
  hookfishFetch: HookfishFetch<Bindings>
  /** Override application origins for a runtime-specific deployment. */
  clientOrigins?:
    | readonly string[]
    | ((bindings: Bindings | undefined) => readonly string[])
  /** Resolve the server-only root key used to sign ephemeral client grants. */
  rootApiKey?: string | ((bindings: Bindings | undefined) => string)
  runtime?: string | ((bindings: Bindings | undefined) => string)
}

export type HookfishBackend<Bindings extends object = object> = {
  fetch(
    request: Request,
    bindings?: Bindings,
    executionContext?: ExecutionContext,
  ): Promise<Response>
}

type ClientOperation =
  | { kind: 'health' }
  | { kind: 'providers' }
  | { kind: 'list' }
  | { kind: 'get'; path: string }
  | { kind: 'authorize'; path: string }
  | { kind: 'secret'; path: string }
  | { kind: 'disconnect'; path: string }

function jsonError(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

function isApiPath(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

function decodeResourceTail(value: string): string | undefined {
  try {
    const segments = value.split('/')
    if (segments.some((segment) => !segment)) return undefined
    const decoded = segments.map((segment) => decodeURIComponent(segment))
    if (
      decoded.some((segment) => segment.includes('/') || segment.includes('\\'))
    ) {
      return undefined
    }
    return decoded.join('/')
  } catch {
    return undefined
  }
}

function parseClientOperation(request: Request): ClientOperation | undefined {
  const url = new URL(request.url)
  const relative = url.pathname.slice(browserApiPath.length)
  const method = request.method.toUpperCase()

  if (relative === '/health' && method === 'GET') return { kind: 'health' }
  if (relative === '/providers' && method === 'GET')
    return { kind: 'providers' }
  if (relative === '/connections' && method === 'GET') return { kind: 'list' }
  if (!relative.startsWith('/connections/')) return undefined

  const tail = relative.slice('/connections/'.length)
  if (method === 'POST' && tail.endsWith('/authorize')) {
    const path = decodeResourceTail(tail.slice(0, -'/authorize'.length))
    return path ? { kind: 'authorize', path } : undefined
  }
  if (method === 'PUT' && tail.endsWith('/secret')) {
    const path = decodeResourceTail(tail.slice(0, -'/secret'.length))
    return path ? { kind: 'secret', path } : undefined
  }

  const path = decodeResourceTail(tail)
  if (!path) return undefined
  if (method === 'GET') return { kind: 'get', path }
  if (method === 'DELETE') return { kind: 'disconnect', path }
  return undefined
}

/** Whether an operation is part of the explicit application-safe API. */
export function isAllowedClientRequest(
  method: string,
  pathname: string,
): boolean {
  return Boolean(
    parseClientOperation(
      new Request(`https://hookfish.invalid${pathname}`, { method }),
    ),
  )
}

export const isAllowedBrowserApiRequest = isAllowedClientRequest

function requestedOrigin<Bindings extends object>(
  request: Request,
  bindings: Bindings | undefined,
  configuredOrigins:
    | readonly string[]
    | ((bindings: Bindings | undefined) => readonly string[])
    | undefined,
): string | null | undefined {
  const origin = request.headers.get('Origin')
  if (!origin) return undefined
  const allowed =
    typeof configuredOrigins === 'function'
      ? configuredOrigins(bindings)
      : (configuredOrigins ?? [])
  return origin === new URL(request.url).origin || allowed.includes(origin)
    ? origin
    : null
}

function addClientHeaders(response: Response, origin?: string): Response {
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'no-store')
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Credentials', 'true')
    headers.append('Vary', 'Origin')
  }
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
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    },
  })
}

function resolveRootApiKey<Bindings extends object>(
  options: HookfishBackendOptions<Bindings>,
  bindings: Bindings | undefined,
): string {
  const configured =
    typeof options.rootApiKey === 'function'
      ? options.rootApiKey(bindings)
      : options.rootApiKey
  if (configured?.trim()) return configured.trim()

  const bindingValue =
    bindings && typeof Reflect.get(bindings, 'HOOKFISH_API_KEY') === 'string'
      ? Reflect.get(bindings, 'HOOKFISH_API_KEY')
      : undefined
  if (typeof bindingValue === 'string' && bindingValue.trim()) {
    return bindingValue.trim()
  }

  const processValue = Reflect.get(globalThis, 'process')
  const environment =
    typeof processValue === 'object' && processValue !== null
      ? Reflect.get(processValue, 'env')
      : undefined
  const ambientValue =
    typeof environment === 'object' && environment !== null
      ? Reflect.get(environment, 'HOOKFISH_API_KEY')
      : undefined
  if (typeof ambientValue === 'string' && ambientValue.trim()) {
    return ambientValue.trim()
  }

  throw new HookfishClientError(
    500,
    'missing_configuration',
    'HOOKFISH_API_KEY is not set. Add it to the runtime bindings or environment.',
  )
}

function encodeResourcePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

function safeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !sensitiveResponseKeys.has(key.replaceAll(/[-_]/g, '').toLowerCase()),
      )
      .map(([key, nested]) => [key, safeJson(nested)]),
  )
}

function safeError(value: unknown, status: number): Response {
  const error =
    value && typeof value === 'object' ? Reflect.get(value, 'error') : undefined
  const code =
    error &&
    typeof error === 'object' &&
    typeof Reflect.get(error, 'code') === 'string'
      ? Reflect.get(error, 'code')
      : 'hookfish_request_failed'
  const message =
    error &&
    typeof error === 'object' &&
    typeof Reflect.get(error, 'message') === 'string'
      ? Reflect.get(error, 'message')
      : `Hookfish request failed (${status}).`
  return jsonError(status, code, message)
}

function stripConnectionRecord(
  tenantId: string,
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const safe = safeJson(value)
  if (!safe || typeof safe !== 'object') return undefined
  const path = Reflect.get(safe, 'path')
  const namespace = Reflect.get(safe, 'namespace')
  if (typeof path !== 'string' || typeof namespace !== 'string')
    return undefined
  const relativePath = stripApplicationNamespace(tenantId, path)
  const relativeNamespace = stripApplicationNamespace(tenantId, namespace)
  if (relativePath === undefined || relativeNamespace === undefined)
    return undefined
  return { ...safe, path: relativePath, namespace: relativeNamespace }
}

async function parseJson(response: Response): Promise<unknown> {
  return response.json().catch(() => undefined)
}

/** Compose the raw server API with the authenticated application facade. */
export function createHookfishBackend<Bindings extends object = object>(
  options: HookfishBackendOptions<Bindings>,
): HookfishBackend<Bindings> {
  return {
    async fetch(request, bindings, executionContext) {
      const url = new URL(request.url)

      if (
        isApiPath(url.pathname, hookfishApiPath) &&
        !isApiPath(url.pathname, browserApiPath)
      ) {
        return options.hookfishFetch(request, bindings, executionContext)
      }

      if (!isApiPath(url.pathname, browserApiPath) || !options.config.auth) {
        return new Response('Not Found', { status: 404 })
      }

      const origin = requestedOrigin(
        request,
        bindings,
        options.clientOrigins ?? options.config.clientOrigins,
      )
      if (origin === null) {
        return jsonError(
          403,
          'untrusted_application_origin',
          'This origin is not allowed to call the Hookfish application API.',
        )
      }
      if (request.method === 'OPTIONS') {
        return origin
          ? preflightResponse(origin)
          : jsonError(403, 'origin_required', 'A trusted Origin is required.')
      }
      if (stateChangingMethods.has(request.method.toUpperCase()) && !origin) {
        return jsonError(
          403,
          'origin_required',
          'State-changing application requests require an exact trusted Origin.',
        )
      }

      let authResult: ApplicationAuthResult
      try {
        authResult = await options.config.auth.authenticate(
          request.clone(),
          bindings,
        )
      } catch (error) {
        console.error('application auth provider error', error)
        return addClientHeaders(
          jsonError(
            500,
            'application_auth_failed',
            'Application authentication failed.',
          ),
          origin,
        )
      }
      if (!authResult.authenticated) {
        return addClientHeaders(authResult.response, origin)
      }

      let principal: ApplicationPrincipal
      try {
        principal = normalizeApplicationPrincipal(authResult.principal)
      } catch (error) {
        if (error instanceof HookfishClientError) {
          return addClientHeaders(
            jsonError(error.status, error.code, error.message),
            origin,
          )
        }
        throw error
      }

      const operation = parseClientOperation(request)
      if (!operation) {
        return addClientHeaders(
          jsonError(
            404,
            'unknown_application_operation',
            'This operation is not available through the application API.',
          ),
          origin,
        )
      }
      if (operation.kind === 'health') {
        const runtime =
          typeof options.runtime === 'function'
            ? options.runtime(bindings)
            : (options.runtime ?? 'fetch')
        return addClientHeaders(
          Response.json({
            ok: true,
            runtime,
            checkedAt: new Date().toISOString(),
          } satisfies HealthResponse),
          origin,
        )
      }

      const rootApiKey = resolveRootApiKey(options, bindings)
      const capability = await mintApplicationAccessToken(rootApiKey, {
        subject: principal.subject,
        tenantId: principal.tenantId,
        scopes: [applicationTenantScope(principal.tenantId)],
      })
      const rawUrl = new URL(request.url)
      const rawHeaders = new Headers({
        Accept: 'application/json',
        Authorization: `Bearer ${capability}`,
        'X-Hookfish-Application-Subject': principal.subject,
        'X-Hookfish-Application-Tenant': principal.tenantId,
      })
      let rawMethod = 'GET'
      let rawBody: string | undefined

      if (operation.kind === 'providers') {
        rawUrl.pathname = '/api/connections/providers'
        rawUrl.search = ''
      } else if (operation.kind === 'list') {
        rawUrl.pathname = '/api/connections'
        const namespace = rawUrl.searchParams.get('namespace')
        if (namespace) {
          rawUrl.searchParams.set(
            'namespace',
            qualifyApplicationNamespace(principal.tenantId, namespace),
          )
        } else {
          rawUrl.searchParams.delete('namespace')
        }
      } else {
        const qualifiedPath = qualifyApplicationPath(
          principal.tenantId,
          operation.path,
        )
        const encoded = encodeResourcePath(qualifiedPath)
        rawUrl.search = ''
        if (operation.kind === 'get' || operation.kind === 'disconnect') {
          rawUrl.pathname = `/api/connections/entry/${encoded}`
          rawMethod = operation.kind === 'disconnect' ? 'DELETE' : 'GET'
        } else if (operation.kind === 'authorize') {
          rawUrl.pathname = `/api/connections/authorize/${encoded}`
          rawMethod = 'POST'
          rawBody = await request.text()
        } else {
          rawUrl.pathname = `/api/connections/secret/${encoded}`
          rawMethod = 'PUT'
          rawBody = await request.text()
        }
      }

      if (rawBody !== undefined)
        rawHeaders.set('Content-Type', 'application/json')
      const rawResponse = await options.hookfishFetch(
        new Request(rawUrl, {
          method: rawMethod,
          headers: rawHeaders,
          ...(rawBody !== undefined ? { body: rawBody } : {}),
        }),
        bindings,
        executionContext,
      )
      const body = await parseJson(rawResponse)

      if (operation.kind === 'authorize') {
        const error =
          body && typeof body === 'object'
            ? Reflect.get(body, 'error')
            : undefined
        if (
          error &&
          typeof error === 'object' &&
          Reflect.get(error, 'code') === 'authorization_required' &&
          typeof Reflect.get(error, 'authorize_url') === 'string' &&
          typeof Reflect.get(error, 'expires_at') === 'string'
        ) {
          return addClientHeaders(
            Response.json({
              path: operation.path,
              authorize_url: Reflect.get(error, 'authorize_url'),
              expires_at: Reflect.get(error, 'expires_at'),
            }),
            origin,
          )
        }
      }

      if (!rawResponse.ok) {
        return addClientHeaders(safeError(body, rawResponse.status), origin)
      }

      let result: unknown = safeJson(body)
      if (operation.kind === 'list') {
        const connections =
          body &&
          typeof body === 'object' &&
          Array.isArray(Reflect.get(body, 'connections'))
            ? Reflect.get(body, 'connections')
            : []
        const stripped = connections.map((connection: unknown) =>
          stripConnectionRecord(principal.tenantId, connection),
        )
        if (stripped.some((connection: unknown) => !connection)) {
          return addClientHeaders(
            jsonError(
              502,
              'tenant_boundary_violation',
              'Hookfish returned a connection outside the authenticated tenant.',
            ),
            origin,
          )
        }
        result = { connections: stripped }
      } else if (operation.kind === 'get') {
        const connection =
          body && typeof body === 'object'
            ? stripConnectionRecord(
                principal.tenantId,
                Reflect.get(body, 'connection'),
              )
            : undefined
        if (!connection) {
          return addClientHeaders(
            jsonError(
              502,
              'tenant_boundary_violation',
              'Hookfish returned a connection outside the authenticated tenant.',
            ),
            origin,
          )
        }
        result = { connection }
      } else if (operation.kind === 'secret') {
        result = { path: operation.path, stored: true }
      }

      return addClientHeaders(Response.json(result), origin)
    },
  }
}

export type HookfishClientRoutesOptions<Bindings extends object = object> =
  Omit<HookfishBackendOptions<Bindings>, 'config'> & {
    auth: ApplicationAuthProvider<Bindings>
    clientOrigins?: HookfishBackendOptions<Bindings>['clientOrigins']
  }

type ClientHonoEnv<Bindings extends object> = { Bindings: Bindings }

function optionalExecutionContext(context: {
  readonly executionCtx: ExecutionContext
}): ExecutionContext | undefined {
  try {
    return context.executionCtx
  } catch {
    return undefined
  }
}

/**
 * Create authenticated Hookfish client routes that can be mounted at any Hono
 * path with `app.route('/api/client', routes)`.
 */
export function createHookfishClientRoutes<Bindings extends object = object>(
  options: HookfishClientRoutesOptions<Bindings>,
): Hono<ClientHonoEnv<Bindings>> {
  const backend = createHookfishBackend({
    config: { auth: options.auth },
    hookfishFetch: options.hookfishFetch,
    clientOrigins: options.clientOrigins,
    rootApiKey: options.rootApiKey,
    runtime: options.runtime,
  })
  const routes = new Hono<ClientHonoEnv<Bindings>>()

  const handle = (context: Context<ClientHonoEnv<Bindings>>) => {
    const url = new URL(context.req.url)
    const wildcardMarker = '/:clientPath{.*}'
    const routePath = context.req.routePath
    const mountPath = routePath.endsWith(wildcardMarker)
      ? routePath.slice(0, -wildcardMarker.length)
      : routePath.replace(/\/$/, '')
    const mountSegmentCount = mountPath.split('/').filter(Boolean).length
    const relativeSegments = url.pathname
      .split('/')
      .slice(1 + mountSegmentCount)
    url.pathname = relativeSegments.length
      ? `${browserApiPath}/${relativeSegments.join('/')}`
      : browserApiPath
    return backend.fetch(
      new Request(url, context.req.raw),
      context.env,
      optionalExecutionContext(context),
    )
  }

  routes.all('/', handle)
  routes.all('/:clientPath{.*}', handle)
  return routes
}
