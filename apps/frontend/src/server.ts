import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import { env } from 'cloudflare:workers'
import app from '@template/api'

/**
 * Same-origin `/api/*` is served by the shared Hono app from `@template/api`.
 * Everything else goes through TanStack Start (SSR, server functions, routes).
 */
export default createServerEntry({
  fetch(request) {
    const { pathname } = new URL(request.url)

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return app.fetch(request, env)
    }

    return handler.fetch(request)
  },
})
