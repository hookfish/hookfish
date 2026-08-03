import path from 'node:path'
import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import { Hookfish } from '@template/api'
import { pglite } from '@template/database/pglite'
import { postgres } from '@template/database/postgres'
import {
  GitHubProvider,
  LinearProvider,
  NotionProvider,
} from '@template/providers'

const databaseUrl = process.env.DATABASE_URL?.trim()
const projectRoot = path.resolve(import.meta.dirname, '../../..')
const db = databaseUrl
  ? postgres(databaseUrl)
  : pglite(process.env.PGLITE_DATA_DIR ?? path.join(projectRoot, 'pgdata'))

const hookfish = new Hookfish({
  db,
  providers: {
    github: new GitHubProvider(),
    linear: new LinearProvider(),
    notion: new NotionProvider(),
  },
})

/**
 * Same-origin `/api/*` is served by the shared Hookfish instance. Everything
 * else goes through TanStack Start (SSR, server functions, routes).
 */
export default createServerEntry({
  fetch(request) {
    const { pathname } = new URL(request.url)

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return hookfish.fetch(request, process.env)
    }

    return handler.fetch(request)
  },
})
