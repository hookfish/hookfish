export type HookfishProxyMethod = 'GET' | 'POST' | 'DELETE'

export type HookfishProxyRequest = {
  path: string
  method: HookfishProxyMethod
  body?: string
}

type HookfishServerFunction = (options: {
  data: HookfishProxyRequest
  signal?: AbortSignal
}) => Promise<Response>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseMethod(value: unknown): HookfishProxyMethod {
  if (value === 'GET' || value === 'POST' || value === 'DELETE') return value
  throw new Error('Unsupported Hookfish request method')
}

export function validateHookfishProxyRequest(
  value: unknown,
): HookfishProxyRequest {
  if (!isRecord(value)) throw new Error('Invalid Hookfish request')

  const method = parseMethod(value.method)
  const path = value.path
  const body = value.body

  if (
    typeof path !== 'string' ||
    !path.startsWith('/api/') ||
    path.startsWith('//') ||
    path.length > 4_096
  ) {
    throw new Error('Invalid Hookfish request path')
  }

  if (body !== undefined && typeof body !== 'string') {
    throw new Error('Invalid Hookfish request body')
  }

  if (typeof body === 'string' && body.length > 65_536) {
    throw new Error('Hookfish request body is too large')
  }

  if (method !== 'POST' && body !== undefined) {
    throw new Error('Only POST Hookfish requests may include a body')
  }

  return { path, method, ...(body === undefined ? {} : { body }) }
}

export function isAllowedHookfishProxyRequest(
  request: HookfishProxyRequest,
): boolean {
  let pathname: string

  try {
    pathname = decodeURIComponent(
      new URL(request.path, 'http://hookfish.internal').pathname,
    )
  } catch {
    return false
  }

  if (request.method === 'GET') {
    return (
      pathname === '/api/stats' ||
      pathname === '/api/oauth/providers' ||
      pathname === '/api/oauth/connections' ||
      pathname.startsWith('/api/oauth/connections/')
    )
  }

  if (request.method === 'POST') {
    return /^\/api\/oauth\/[^/]+\/authorize$/.test(pathname)
  }

  return (
    pathname.startsWith('/api/oauth/connections/') &&
    pathname.length > '/api/oauth/connections/'.length
  )
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function requestMethod(
  input: RequestInfo | URL,
  init?: RequestInit,
): HookfishProxyMethod {
  const method =
    init?.method ?? (input instanceof Request ? input.method : 'GET')
  return parseMethod(method.toUpperCase())
}

async function requestBody(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<string | undefined> {
  if (typeof init?.body === 'string') return init.body

  if (init?.body !== undefined && init.body !== null) {
    throw new Error('Hookfish only supports JSON request bodies')
  }

  if (input instanceof Request && !init?.body && input.body) {
    return input.clone().text()
  }

  return undefined
}

export function createHookfishServerFetch(
  serverFunction: HookfishServerFunction,
): typeof fetch {
  return async (input, init) => {
    const signal =
      init?.signal ?? (input instanceof Request ? input.signal : undefined)

    if (signal?.aborted) {
      throw new DOMException('The operation was aborted', 'AbortError')
    }

    const url = new URL(requestUrl(input), 'http://hookfish.internal')
    const data = validateHookfishProxyRequest({
      path: `${url.pathname}${url.search}`,
      method: requestMethod(input, init),
      body: await requestBody(input, init),
    })

    return serverFunction({ data, ...(signal ? { signal } : {}) })
  }
}
