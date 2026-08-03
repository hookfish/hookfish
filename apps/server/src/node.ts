import path from 'node:path'
import { serve } from '@hono/node-server'
import { Hookfish } from '@template/api'
import { readEnvString } from '@template/api/oauth/config'
import { pglite } from '@template/database/pglite'
import { postgres } from '@template/database/postgres'
import {
  GitHubProvider,
  LinearProvider,
  NotionProvider,
} from '@template/providers'

const packageRoot = path.resolve(import.meta.dirname, '..')
const envPath = path.join(packageRoot, '.env')

try {
  process.loadEnvFile(envPath)
  console.log(`Loaded env from ${envPath}`)
} catch {
  console.warn(
    `No .env at ${envPath} -- using the ambient environment only.\n` +
      '  Credentials belong in .env, not .env.example (that one is a committed template).\n' +
      '  Create it with: cp apps/server/.env.example apps/server/.env',
  )
}

const port = Number(process.env.PORT ?? 8787)
const hostname = process.env.HOST ?? '127.0.0.1'
const defaultDataDir = path.resolve(packageRoot, '../..', 'pgdata')
const databaseUrl = process.env.DATABASE_URL?.trim()
const db = databaseUrl
  ? postgres(databaseUrl)
  : pglite(process.env.PGLITE_DATA_DIR ?? defaultDataDir)

const hookfish = new Hookfish({
  db,
  providers: {
    github: new GitHubProvider(),
    linear: new LinearProvider(),
    notion: new NotionProvider(),
  },
})

serve(
  {
    fetch: (request: Request) => hookfish.fetch(request, process.env),
    port,
    hostname,
  },
  (info) => {
    const providerIds = hookfish.providers.listProviderIds()
    const configured = providerIds.filter((id) =>
      hookfish.providers.isProviderConfigured(id),
    )
    const publicOrigin =
      readEnvString(process.env, 'OAUTH_REDIRECT_BASE_URL') ??
      `http://localhost:${info.port}`

    console.log(`OAuth broker on ${publicOrigin}/api`)
    console.log(
      process.env.DATABASE_URL?.trim()
        ? 'Database: Postgres via DATABASE_URL'
        : `Database: PGlite at ${process.env.PGLITE_DATA_DIR ?? defaultDataDir}`,
    )
    console.log(
      configured.length > 0
        ? `Providers configured: ${configured.join(', ')}`
        : 'Providers configured: none -- set <PROVIDER>_CLIENT_ID and _CLIENT_SECRET in .env',
    )
  },
)
