import { swaggerUI } from '@hono/swagger-ui'
import { OpenAPIHono } from '@hono/zod-openapi'
import { cors } from 'hono/cors'

import type { BrokerContext } from './oauth/middleware'
import { oauthRoutes } from './routes/oauth'
import { statsRoutes } from './routes/stats'

const base = new OpenAPIHono<BrokerContext>()

base.openAPIRegistry.registerComponent('securitySchemes', 'brokerApiKey', {
  type: 'http',
  scheme: 'bearer',
  description: 'Send BROKER_API_KEY as `Authorization: Bearer <key>`.',
})

const api = base
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
  .route('/oauth', oauthRoutes)

const app = new OpenAPIHono<BrokerContext>().route('/api', api)

export type AppType = typeof api

export default app
