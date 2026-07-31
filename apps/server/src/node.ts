import path from 'node:path'
import { serve } from '@hono/node-server'
import app from '@template/api'
import { createLocalBrokerEnv } from '@template/api/local-node'
import { type BrokerEnv, readEnvString } from '@template/api/oauth/config'
import { listConfiguredProviderIds } from '@template/api/oauth/providers'

/**
 * Standalone API entrypoint.
 *
 * Database modes (see `@template/api/local-node` / OAUTH.md):
 * - Leave DATABASE_URL unset → embedded PGlite under `pgdata` (default local)
 * - Set DATABASE_URL → stock Node against any Postgres
 *
 * Deployed Workers use `env.HYPERDRIVE` (preferred) or `DATABASE_URL` instead;
 * PGlite cannot persist inside workerd.
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
 * Portless sets HOST/PORT when this is launched via `pnpm --filter @template/server dev`.
 */
const hostname = process.env.HOST ?? '127.0.0.1'

const env: BrokerEnv = await createLocalBrokerEnv(dataDir)

serve(
  { fetch: (request: Request) => app.fetch(request, env), port, hostname },
  async (info) => {
    const configured = env.DB ? await listConfiguredProviderIds(env.DB) : []
    const publicOrigin =
      readEnvString(env, 'OAUTH_REDIRECT_BASE_URL') ??
      `http://localhost:${info.port}`

    console.log(`OAuth broker on ${publicOrigin}/api`)
    console.log(
      readEnvString(env, 'DATABASE_URL')
        ? 'Database: Postgres via DATABASE_URL (stock Node)'
        : `Database: PGlite at ${dataDir}`,
    )
    console.log(
      configured.length > 0
        ? `Providers configured: ${configured.join(', ')}`
        : 'Providers configured: none -- PATCH /api/oauth/providers/{id} with client_id and client_secret',
    )
  },
)
