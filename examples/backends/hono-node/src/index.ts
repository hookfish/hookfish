import { serve } from '@hono/node-server'
import { Hookfish } from '@hookfish/api'
import config from '../hookfish.config'

const hookfish = await Hookfish.init(config)
const providers = await hookfish.getProviders(process.env)

const port = Number(process.env.PORT ?? 8787)
const hostname = process.env.HOST ?? '127.0.0.1'
serve(
  {
    fetch: (request: Request) => hookfish.fetch(request, process.env),
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

    console.log(`OAuth broker on ${publicOrigin}/api`)
    console.log(
      configured.length > 0
        ? `Providers configured: ${configured.join(', ')}`
        : 'Providers configured: none -- set <PROVIDER>_CLIENT_ID and _CLIENT_SECRET in .env',
    )
  },
)
