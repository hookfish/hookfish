import path from 'node:path'
import { serve } from '@hono/node-server'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { createPgliteDatabase } from './db/pglite'
import app from './index'
import { type BrokerEnv, isProviderConfigured } from './oauth/config'
import { providerIds } from './oauth/providers'

/**
 * Local development entrypoint.
 *
 * PGlite cannot persist inside workerd -- its Node FS / IndexedDB / OPFS
 * backends are all unavailable there -- so `wrangler dev` and production run
 * against HTTP Postgres via DATABASE_URL. This entrypoint runs the exact same
 * Hono app on Node with PGlite writing to disk, which is what makes the
 * zero-setup local database possible.
 */

/**
 * Anchor every path to the package, not the shell's working directory, so this
 * behaves identically whether you launch from the repo root or from apps/server.
 */
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

const dataDir = process.env.PGLITE_DATA_DIR ?? path.join(packageRoot, 'pgdata')
const port = Number(process.env.PORT ?? 8787)

/**
 * `pnpm dev` runs this behind the portless proxy, which sets HOST/PORT and
 * expects the app on the loopback interface it aliased.
 */
const hostname = process.env.HOST ?? '127.0.0.1'

const { db } = createPgliteDatabase(dataDir)

await migrate(db, { migrationsFolder: path.join(packageRoot, 'drizzle') })

const env: BrokerEnv = { ...process.env, DB: db }

serve(
  { fetch: (request: Request) => app.fetch(request, env), port, hostname },
  (info) => {
    const configured = providerIds.filter((id) => isProviderConfigured(env, id))

    console.log(`OAuth broker on http://localhost:${info.port}/api`)
    console.log(`PGlite data directory: ${dataDir}`)
    console.log(
      configured.length > 0
        ? `Providers configured: ${configured.join(', ')}`
        : 'Providers configured: none -- set <PROVIDER>_CLIENT_ID and _CLIENT_SECRET in .env',
    )
  },
)
