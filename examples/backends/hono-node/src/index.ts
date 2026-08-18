import { serve } from '@hono/node-server'
import { HookfishServer } from '@hookfish/api'
import { Hono } from 'hono'
import config from '../hookfish.config.ts'

const hookfishServer = await HookfishServer.init(config)
const providers = await hookfishServer.getProviders(process.env)
const app = new Hono().route('/', hookfishServer)

const port = Number(process.env.PORT ?? 8787)
const hostname = process.env.HOST ?? '127.0.0.1'
serve(
  {
    fetch: (request: Request) => app.fetch(request, process.env),
    port,
    hostname,
  },
  (info) => {
    const providerIds = providers.listProviderIds()
    const configured = providerIds.filter((id) =>
      providers.isProviderConfigured(id),
    )
    const publicOrigin =
      process.env.OAUTH_REDIRECT_BASE_URL ?? `http://localhost:${info.port}`

    console.log(`OAuth broker on ${publicOrigin}/api/docs`)
    console.log(
      configured.length > 0
        ? `Providers configured: ${configured.join(', ')}`
        : 'Providers configured: none -- set <PROVIDER>_CLIENT_ID and _CLIENT_SECRET in .env',
    )
  },
)
