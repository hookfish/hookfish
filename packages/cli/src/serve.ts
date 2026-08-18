export const defaultFrontendHostname = 'localhost'

export function resolveBackendUrl(
  configuredBackendUrl: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const backendUrl =
    configuredBackendUrl?.trim() || environment.HOOKFISH_BACKEND_URL?.trim()
  if (!backendUrl) {
    throw new Error(
      '--backend-url or HOOKFISH_BACKEND_URL is required to serve the dashboard.',
    )
  }

  const parsedBackendUrl = new URL(backendUrl)
  if (!['http:', 'https:'].includes(parsedBackendUrl.protocol)) {
    throw new Error('--backend-url must use http or https.')
  }

  return backendUrl
}

/**
 * Forward an API request without consuming redirects. OAuth callbacks must
 * return their 302 to the browser so its address moves off the callback route.
 */
export async function proxyBackendRequest(
  request: Request,
  target: URL,
): Promise<Response> {
  const requestHeaders = new Headers(request.headers)
  requestHeaders.delete('Authorization')
  requestHeaders.delete('Cookie')
  const proxiedRequest = new Request(target, {
    method: request.method,
    headers: requestHeaders,
    ...(request.method === 'GET' || request.method === 'HEAD'
      ? {}
      : { body: await request.arrayBuffer() }),
  })
  const response = await fetch(proxiedRequest, {
    redirect: 'manual',
  })
  const headers = new Headers(response.headers)

  // Node's fetch transparently decompresses response bodies but retains the
  // backend's compression and byte-length headers. Forwarding those headers
  // makes browsers try to decompress an already-decoded body, which surfaces
  // as a generic `Failed to fetch` error.
  headers.delete('content-encoding')
  headers.delete('content-length')

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export const operatorSessionCookie = 'hookfish_operator_session'

type OperatorOperation = {
  targetPath: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  authorizationResponse?: boolean
}

function decodePath(value: string): string | undefined {
  try {
    const segments = value.split('/')
    if (segments.some((segment) => !segment)) return undefined
    const decoded = segments.map(decodeURIComponent)
    if (
      decoded.some((segment) => segment.includes('/') || segment.includes('\\'))
    ) {
      return undefined
    }
    return decoded.map(encodeURIComponent).join('/')
  } catch {
    return undefined
  }
}

function operatorOperation(request: Request): OperatorOperation | undefined {
  const url = new URL(request.url)
  const prefix = '/api/client'
  if (!url.pathname.startsWith(`${prefix}/`)) return undefined
  const relative = url.pathname.slice(prefix.length)
  const method = request.method.toUpperCase()
  if (relative === '/providers' && method === 'GET') {
    return { targetPath: '/api/connections/providers', method: 'GET' }
  }
  if (relative === '/connections' && method === 'GET') {
    return {
      targetPath: `/api/connections${url.search}`,
      method: 'GET',
    }
  }
  if (!relative.startsWith('/connections/')) return undefined
  const tail = relative.slice('/connections/'.length)
  if (method === 'POST' && tail.endsWith('/authorize')) {
    const path = decodePath(tail.slice(0, -'/authorize'.length))
    return path
      ? {
          targetPath: `/api/connections/authorize/${path}`,
          method: 'POST',
          authorizationResponse: true,
        }
      : undefined
  }
  if (method === 'PUT' && tail.endsWith('/secret')) {
    const path = decodePath(tail.slice(0, -'/secret'.length))
    return path
      ? { targetPath: `/api/connections/secret/${path}`, method: 'PUT' }
      : undefined
  }
  const path = decodePath(tail)
  if (!path) return undefined
  if (method === 'GET') {
    return { targetPath: `/api/connections/entry/${path}`, method: 'GET' }
  }
  if (method === 'DELETE') {
    return {
      targetPath: `/api/connections/entry/${path}`,
      method: 'DELETE',
    }
  }
  return undefined
}

function hasOperatorSession(request: Request, sessionToken: string): boolean {
  const cookies = request.headers.get('Cookie')?.split(';') ?? []
  return cookies.some((cookie) => {
    const [name, ...value] = cookie.trim().split('=')
    return name === operatorSessionCookie && value.join('=') === sessionToken
  })
}

function operatorError(
  status: number,
  code: string,
  message: string,
): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

function safeBackendError(body: unknown, status: number): Response {
  const error =
    body && typeof body === 'object' ? Reflect.get(body, 'error') : undefined
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
  return operatorError(status, code, message)
}

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

function safeOperatorJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeOperatorJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !sensitiveResponseKeys.has(key.replaceAll(/[-_]/g, '').toLowerCase()),
      )
      .map(([key, nested]) => [key, safeOperatorJson(nested)]),
  )
}

export type OperatorBff = {
  fetch(request: Request): Promise<Response>
  sessionCookie(secure?: boolean): string
}

/** Restricted local BFF for the packaged operator dashboard. */
export function createOperatorBff(options: {
  backendOrigin: string
  frontendOrigin: string
  brokerApiKey: string
  sessionToken: string
}): OperatorBff {
  return {
    sessionCookie(secure = false) {
      return `${operatorSessionCookie}=${options.sessionToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${secure ? '; Secure' : ''}`
    },
    async fetch(request) {
      if (!hasOperatorSession(request, options.sessionToken)) {
        return operatorError(
          401,
          'operator_auth_required',
          'Reload the local Hookfish dashboard to start an operator session.',
        )
      }
      const origin = request.headers.get('Origin')
      if (origin && origin !== options.frontendOrigin) {
        return operatorError(
          403,
          'untrusted_operator_origin',
          'This origin cannot use the Hookfish operator session.',
        )
      }
      if (
        ['POST', 'PUT', 'DELETE'].includes(request.method.toUpperCase()) &&
        origin !== options.frontendOrigin
      ) {
        return operatorError(
          403,
          'operator_origin_required',
          'State-changing operator requests require the dashboard origin.',
        )
      }

      const operation = operatorOperation(request)
      if (!operation) {
        return operatorError(
          404,
          'unknown_operator_operation',
          'This operation is not available in the operator dashboard.',
        )
      }
      const target = new URL(operation.targetPath, options.backendOrigin)
      const headers = new Headers({
        Accept: 'application/json',
        Authorization: `Bearer ${options.brokerApiKey}`,
      })
      let body: string | undefined
      if (operation.method === 'POST' || operation.method === 'PUT') {
        body = await request.text()
        headers.set('Content-Type', 'application/json')
      }
      const backendResponse = await fetch(target, {
        method: operation.method,
        headers,
        ...(body === undefined ? {} : { body }),
        redirect: 'manual',
      })
      const payload: unknown = await backendResponse
        .json()
        .catch(() => undefined)
      if (operation.authorizationResponse) {
        const error =
          payload && typeof payload === 'object'
            ? Reflect.get(payload, 'error')
            : undefined
        if (
          error &&
          typeof error === 'object' &&
          Reflect.get(error, 'code') === 'authorization_required' &&
          typeof Reflect.get(error, 'authorize_url') === 'string' &&
          typeof Reflect.get(error, 'expires_at') === 'string'
        ) {
          const relativePath = operation.targetPath.slice(
            '/api/connections/authorize/'.length,
          )
          return Response.json({
            path: relativePath.split('/').map(decodeURIComponent).join('/'),
            authorize_url: Reflect.get(error, 'authorize_url'),
            expires_at: Reflect.get(error, 'expires_at'),
          })
        }
      }
      if (!backendResponse.ok) {
        return safeBackendError(payload, backendResponse.status)
      }
      return Response.json(safeOperatorJson(payload), {
        headers: { 'Cache-Control': 'no-store' },
      })
    },
  }
}
