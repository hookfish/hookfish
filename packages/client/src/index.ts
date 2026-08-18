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
  /** Exact origin serving the browser client. */
  frontendOrigin: string
  /** Ephemeral server-generated value used by the HttpOnly operator cookie. */
  sessionToken: string
  /** Delegate non-client requests to the host application. */
  fallback?: (request: Request) => Response | Promise<Response>
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
      headers.append(
        'set-cookie',
        operator.sessionCookie(new URL(context.req.url).protocol === 'https:'),
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
