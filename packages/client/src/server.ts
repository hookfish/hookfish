import {
  mintApplicationAccessToken,
  normalizeResourcePath,
} from '@hookfish/api/capabilities'
import { Hono } from 'hono'

import {
  type ApplicationAuthProvider,
  type ApplicationAuthResult,
  type ApplicationPrincipal,
  applicationScope,
  normalizeApplicationPrincipal,
  pathIsWithinBase,
} from './auth.js'

export const browserApiPath = '/api/client'

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

export type ClientContextResponse = {
  subject: string
  basePath: string | null
  scopes: string[]
  roles?: readonly string[]
}

export type HookfishClientServerOptions<Bindings extends object = object> = {
  auth: ApplicationAuthProvider<Bindings>
  /** URL of the separately running raw Hookfish API. */
  backendUrl: string | ((bindings: Bindings | undefined) => string)
  /** Root key for base-path grants, or a root/downscoped token for direct mode. */
  apiKey: string | ((bindings: Bindings | undefined) => string)
  clientOrigins?:
    | readonly string[]
    | ((bindings: Bindings | undefined) => readonly string[])
  fetch?: (request: Request) => Promise<Response>
}

export type HookfishClientApp<Bindings extends object = object> = Hono<{
  Bindings: Bindings
}>

type ClientOperation =
  | { kind: 'context' }
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
    return normalizeResourcePath(decoded.join('/'), 'connection')
  } catch {
    return undefined
  }
}

function parseClientOperation(request: Request): ClientOperation | undefined {
  const url = new URL(request.url)
  const relative = url.pathname.slice(browserApiPath.length)
  const method = request.method.toUpperCase()

  if (relative === '/context' && method === 'GET') return { kind: 'context' }
  if (relative === '/providers' && method === 'GET') {
    return { kind: 'providers' }
  }
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

export function isAllowedBrowserApiRequest(
  method: string,
  pathname: string,
): boolean {
  return Boolean(
    parseClientOperation(
      new Request(`https://hookfish.invalid${pathname}`, { method }),
    ),
  )
}

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
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    },
  })
}

function resolveOption<Bindings extends object>(
  value: string | ((bindings: Bindings | undefined) => string),
  bindings: Bindings | undefined,
): string {
  return typeof value === 'function' ? value(bindings) : value
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

function safeConnectionRecord(
  basePath: string | null,
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const safe = safeJson(value)
  if (!safe || typeof safe !== 'object') return undefined
  const path = Reflect.get(safe, 'path')
  const namespace = Reflect.get(safe, 'namespace')
  if (typeof path !== 'string' || typeof namespace !== 'string') {
    return undefined
  }
  if (basePath !== null && !pathIsWithinBase(basePath, path)) return undefined
  if (
    basePath !== null &&
    namespace !== basePath &&
    !pathIsWithinBase(basePath, namespace)
  ) {
    return undefined
  }
  return Object.fromEntries(Object.entries(safe))
}

async function parseJson(response: Response): Promise<unknown> {
  return response.json().catch(() => undefined)
}

function operationPathIsAllowed(
  principal: ApplicationPrincipal,
  operation: ClientOperation,
  request: Request,
): boolean {
  if (
    operation.kind === 'get' ||
    operation.kind === 'authorize' ||
    operation.kind === 'secret' ||
    operation.kind === 'disconnect'
  ) {
    return (
      principal.basePath === null ||
      pathIsWithinBase(principal.basePath, operation.path)
    )
  }
  if (operation.kind === 'list') {
    const namespace = new URL(request.url).searchParams.get('namespace')
    return (
      principal.basePath === null ||
      !namespace ||
      pathIsWithinBase(principal.basePath, namespace)
    )
  }
  return true
}

/** Create the authenticated, browser-safe Hono app for a separate Hookfish API. */
export function createHookfishClient<Bindings extends object = object>(
  options: HookfishClientServerOptions<Bindings>,
): HookfishClientApp<Bindings> {
  const app = new Hono<{ Bindings: Bindings }>()

  app.all(`${browserApiPath}/*`, async (context) => {
    const request = context.req.raw
    const bindings = context.env

    const origin = requestedOrigin(request, bindings, options.clientOrigins)
    if (origin === null) {
      return jsonError(
        403,
        'untrusted_application_origin',
        'This origin is not allowed to call the Hookfish client API.',
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
        'State-changing client requests require an exact trusted Origin.',
      )
    }

    let authResult: ApplicationAuthResult
    try {
      authResult = await options.auth.authenticate(request.clone(), bindings)
    } catch (error) {
      console.error('client auth provider error', error)
      return addClientHeaders(
        jsonError(500, 'application_auth_failed', 'Authentication failed.'),
        origin,
      )
    }
    if (!authResult.authenticated) {
      return addClientHeaders(authResult.response, origin)
    }

    let principal: ApplicationPrincipal
    try {
      principal = normalizeApplicationPrincipal(authResult.principal)
    } catch {
      return addClientHeaders(
        jsonError(
          403,
          'invalid_application_principal',
          'The auth provider returned an invalid subject or base path.',
        ),
        origin,
      )
    }

    const operation = parseClientOperation(request)
    if (!operation) {
      return addClientHeaders(
        jsonError(
          404,
          'unknown_application_operation',
          'This operation is not available through the client API.',
        ),
        origin,
      )
    }
    if (operation.kind === 'context' && principal.basePath !== null) {
      return addClientHeaders(
        Response.json({
          subject: principal.subject,
          basePath: principal.basePath,
          scopes: [applicationScope(principal.basePath)],
          ...(principal.roles ? { roles: principal.roles } : {}),
        } satisfies ClientContextResponse),
        origin,
      )
    }
    let operationAllowed: boolean
    try {
      operationAllowed = operationPathIsAllowed(principal, operation, request)
    } catch {
      return addClientHeaders(
        jsonError(
          400,
          'invalid_client_resource_path',
          'Browser resource paths must use canonical slash-delimited identifiers.',
        ),
        origin,
      )
    }
    if (!operationAllowed) {
      return addClientHeaders(
        jsonError(
          403,
          'outside_base_path',
          'The requested resource is outside the authenticated base path.',
        ),
        origin,
      )
    }

    const apiKey = resolveOption(options.apiKey, bindings)
    const capability =
      principal.basePath === null
        ? apiKey
        : await mintApplicationAccessToken(apiKey, {
            subject: principal.subject,
            basePath: principal.basePath,
            scopes: [applicationScope(principal.basePath)],
          })
    const rawUrl = new URL(resolveOption(options.backendUrl, bindings))
    const rawHeaders = new Headers({
      Accept: 'application/json',
      Authorization: `Bearer ${capability}`,
      'X-Hookfish-Application-Subject': principal.subject,
    })
    if (principal.basePath !== null) {
      rawHeaders.set('X-Hookfish-Application-Base-Path', principal.basePath)
    }
    let rawMethod = 'GET'
    let rawBody: string | undefined

    if (operation.kind === 'context') {
      rawUrl.pathname = '/api/access'
      rawUrl.search = ''
    } else if (operation.kind === 'providers') {
      rawUrl.pathname = '/api/connections/providers'
      rawUrl.search = ''
    } else if (operation.kind === 'list') {
      rawUrl.pathname = '/api/connections'
      rawUrl.search = new URL(request.url).search
      if (
        principal.basePath !== null &&
        !rawUrl.searchParams.has('namespace')
      ) {
        rawUrl.searchParams.set('namespace', principal.basePath)
      }
    } else {
      const encoded = encodeResourcePath(operation.path)
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
    const rawResponse = await (options.fetch ?? globalThis.fetch)(
      new Request(rawUrl, {
        method: rawMethod,
        headers: rawHeaders,
        ...(rawBody !== undefined ? { body: rawBody } : {}),
      }),
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
    if (operation.kind === 'context') {
      const rawScopes =
        body && typeof body === 'object'
          ? Reflect.get(body, 'scopes')
          : undefined
      const scopes = Array.isArray(rawScopes)
        ? rawScopes.filter(
            (scope: unknown): scope is string => typeof scope === 'string',
          )
        : undefined
      if (
        !Array.isArray(rawScopes) ||
        !scopes ||
        scopes.length !== rawScopes.length
      ) {
        return addClientHeaders(
          jsonError(
            502,
            'invalid_access_context',
            'Hookfish returned an invalid access context.',
          ),
          origin,
        )
      }
      const onlyScope = scopes.length === 1 ? scopes[0] : undefined
      result = {
        subject: principal.subject,
        basePath:
          onlyScope && onlyScope !== '**' && onlyScope.endsWith('/**')
            ? onlyScope.slice(0, -3)
            : null,
        scopes,
        ...(principal.roles ? { roles: principal.roles } : {}),
      } satisfies ClientContextResponse
    } else if (operation.kind === 'list') {
      const connections =
        body &&
        typeof body === 'object' &&
        Array.isArray(Reflect.get(body, 'connections'))
          ? Reflect.get(body, 'connections')
          : []
      const safeConnections = connections.map((connection: unknown) =>
        safeConnectionRecord(principal.basePath, connection),
      )
      if (safeConnections.some((connection: unknown) => !connection)) {
        return addClientHeaders(
          jsonError(
            502,
            'base_path_boundary_violation',
            'Hookfish returned a connection outside the authenticated base path.',
          ),
          origin,
        )
      }
      result = { connections: safeConnections }
    } else if (operation.kind === 'get') {
      const connection =
        body && typeof body === 'object'
          ? safeConnectionRecord(
              principal.basePath,
              Reflect.get(body, 'connection'),
            )
          : undefined
      if (!connection) {
        return addClientHeaders(
          jsonError(
            502,
            'base_path_boundary_violation',
            'Hookfish returned a connection outside the authenticated base path.',
          ),
          origin,
        )
      }
      result = { connection }
    } else if (operation.kind === 'secret') {
      result = { path: operation.path, stored: true }
    }

    return addClientHeaders(Response.json(result), origin)
  })

  return app
}
