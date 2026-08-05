import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import { hookfishServer } from '@/lib/hookfish-server.server'

/**
 * Same-origin `/api/*` is served by the shared Hookfish instance. Everything
 * else goes through TanStack Start (SSR, server functions, routes).
 */
export default createServerEntry({
  fetch(request) {
    const { pathname } = new URL(request.url)

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return hookfishServer.fetch(request)
    }

    return handler.fetch(request)
  },
})
