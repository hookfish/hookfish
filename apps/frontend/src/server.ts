import path from 'node:path'
import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import { createApi } from '@template/api'
import { createLocalBrokerEnv } from '@template/api/local-node'
import { providers } from '../../../index.ts'

const app = createApi({ providers })
const dataDir = process.env.PGLITE_DATA_DIR ?? path.resolve('pgdata')
const brokerEnv = createLocalBrokerEnv(dataDir)

/**
 * Same-origin `/api/*` is served by the shared Hono app from `@template/api`.
 * Everything else goes through TanStack Start (SSR, server functions, routes).
 */
export default createServerEntry({
  async fetch(request) {
    const { pathname } = new URL(request.url)

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return app.fetch(request, await brokerEnv)
    }

    return handler.fetch(request)
  },
})
