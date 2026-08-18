import { Hono } from 'hono'
import {
  createOperatorBff,
  proxyBackendRequest,
  resolveBackendUrl,
} from './operator.js'

export type HookfishClientOptions = {
  /** Origin of the separately running Hookfish API. */
  apiUrl: string
  /** Server-only root key, or a lazy reader for it, used by the safe facade. */
  apiKey: string | (() => string | undefined)
  /** Exact browser origin, or a request-aware resolver for it. */
  frontendOrigin: string | ((request: Request) => string)
  /** Ephemeral server-generated value used by the HttpOnly operator cookie. */
  sessionToken: string
  /** Delegate non-client requests to the host application. */
  fallback?: (request: Request) => Response | Promise<Response>
}

const frontendSecurityHeaders = {
  'content-security-policy':
    "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self' https:",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
} as const

function isSecureRequest(request: Request): boolean {
  if (new URL(request.url).protocol === 'https:') return true
  const forwardedProto = request.headers
    .get('x-forwarded-proto')
    ?.split(',', 1)[0]
    ?.trim()
    .toLowerCase()
  if (forwardedProto === 'https') return true
  const forwarded = request.headers
    .get('forwarded')
    ?.split(',', 1)[0]
    ?.split(';')
    .map((part) => part.trim().toLowerCase())
  return (
    forwarded?.some(
      (part) => part === 'proto=https' || part === 'proto="https"',
    ) ?? false
  )
}

/**
 * Create the mountable Hono application used by the Hookfish frontend.
 *
 * It exposes only the browser-safe connection operations and the public OAuth
 * callback endpoints. The raw Hookfish API and its root credential are never
 * forwarded to the browser.
 */
export function createHookfishClient(options: HookfishClientOptions) {
  const backendOrigin = resolveBackendUrl(options.apiUrl, {})
  const operator = createOperatorBff({
    backendOrigin,
    frontendOrigin: options.frontendOrigin,
    brokerApiKey: options.apiKey,
    sessionToken: options.sessionToken,
  })
  const app = new Hono()

  app.all('/api/client', (context) => operator.fetch(context.req.raw))
  app.all('/api/client/*', (context) => operator.fetch(context.req.raw))

  const proxyPublicApi = async (request: Request) => {
    const url = new URL(request.url)
    const target = new URL(`${url.pathname}${url.search}`, backendOrigin)
    try {
      return await proxyBackendRequest(request, target)
    } catch (error) {
      return Response.json(
        {
          error: {
            code: 'backend_unavailable',
            message: error instanceof Error ? error.message : String(error),
          },
        },
        { status: 502 },
      )
    }
  }

  app.all('/api/connections/callback/*', (context) =>
    proxyPublicApi(context.req.raw),
  )
  app.all('/api/connections/client-metadata.json', (context) =>
    proxyPublicApi(context.req.raw),
  )

  if (options.fallback) {
    app.all('*', async (context) => {
      const response = await options.fallback?.(context.req.raw)
      if (!response) return context.notFound()
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.includes('text/html')) return response
      const headers = new Headers(response.headers)
      for (const [name, value] of Object.entries(frontendSecurityHeaders)) {
        if (!headers.has(name)) headers.set(name, value)
      }
      headers.append(
        'set-cookie',
        operator.sessionCookie(isSecureRequest(context.req.raw)),
      )
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    })
  }

  return app
}

export type HookfishClient = ReturnType<typeof createHookfishClient>
