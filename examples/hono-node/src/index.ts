import path from 'node:path'
import { serve } from '@hono/node-server'
import { readEnvString } from '@template/api/oauth/config'

const packageRoot = path.resolve(import.meta.dirname, '..')
const envPath = path.resolve(packageRoot, '../../apps/frontend/.env')

try {
  process.loadEnvFile(envPath)
  console.log(`Loaded env from ${envPath}`)
} catch {
  console.warn(
    `No .env at ${envPath} -- using the ambient environment only.\n` +
      '  Credentials belong in .env, not .env.example (that one is a committed template).\n' +
      '  Create it with: cp apps/frontend/.env.example apps/frontend/.env',
  )
}

const { default: hookfish } = await import('../../../hookfish.config')

const port = Number(process.env.PORT ?? 8787)
const hostname = process.env.HOST ?? '127.0.0.1'
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
      configured.length > 0
        ? `Providers configured: ${configured.join(', ')}`
        : 'Providers configured: none -- set <PROVIDER>_CLIENT_ID and _CLIENT_SECRET in .env',
    )
  },
)
