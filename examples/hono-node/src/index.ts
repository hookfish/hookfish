import path from 'node:path'
import { serve } from '@hono/node-server'

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

const { Hookfish } = await import('@hookfish/api')
const { createHookfishBackend } = await import('@hookfish/backend')
const { default: config } = await import('../../../hookfish.config')
const hookfish = await Hookfish.init(config)
const backend = createHookfishBackend<NodeJS.ProcessEnv>({
  hookfishFetch: hookfish.fetch,
  browserOrigins: config.trustedOrigins,
  runtime: 'node',
})

const port = Number(
  process.env.HOOKFISH_BACKEND_PORT ?? process.env.PORT ?? 8787,
)
const hostname = process.env.HOST ?? '127.0.0.1'
serve(
  {
    fetch: (request: Request) => backend.fetch(request, process.env),
    port,
    hostname,
  },
  (info) => {
    const providerIds = hookfish.providers.listProviderIds()
    const configured = providerIds.filter((id) =>
      hookfish.providers.isProviderConfigured(id),
    )
    const publicOrigin =
      process.env.OAUTH_REDIRECT_BASE_URL ?? `http://localhost:${info.port}`

    console.log(`Hookfish backend on ${publicOrigin}`)
    console.log(`Raw API on ${publicOrigin}/api`)
    console.log(`Browser API on ${publicOrigin}/client`)
    console.log(
      configured.length > 0
        ? `Providers configured: ${configured.join(', ')}`
        : 'Providers configured: none -- set <PROVIDER>_CLIENT_ID and _CLIENT_SECRET in .env',
    )
  },
)
