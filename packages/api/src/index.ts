import { swaggerUI } from '@hono/swagger-ui'
import { OpenAPIHono } from '@hono/zod-openapi'
import {
  defaultProviderRegistry,
  type ProviderRegistry,
} from '@template/provider'
import { cors } from 'hono/cors'

import type { BrokerContext } from './oauth/middleware'
import { createOAuthRoutes } from './routes/oauth'
import { statsRoutes } from './routes/stats'

function createApiRoutes(providers: ProviderRegistry) {
  const base = new OpenAPIHono<BrokerContext>()

  base.openAPIRegistry.registerComponent('securitySchemes', 'brokerApiKey', {
    type: 'http',
    scheme: 'bearer',
    description: 'Send BROKER_API_KEY as `Authorization: Bearer <key>`.',
  })

  return base
    .doc('/openapi.json', {
      openapi: '3.1.0',
      info: {
        title: 'Template API',
        version: '0.0.0',
      },
      servers: [{ url: '/api' }],
    })
    .get('/', swaggerUI({ url: '/api/openapi.json' }))
    .use('/stats', cors())
    .route('/stats', statsRoutes)
    .use('/oauth/*', cors())
    .route('/oauth', createOAuthRoutes(providers))
}

export type CreateApiOptions = {
  providers?: ProviderRegistry
}

export function createApi(options: CreateApiOptions = {}) {
  const api = createApiRoutes(options.providers ?? defaultProviderRegistry)
  return new OpenAPIHono<BrokerContext>().route('/api', api)
}

export type AppType = ReturnType<typeof createApiRoutes>

const app = createApi()
export default app
