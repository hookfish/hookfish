import { OpenAPIHono } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import { cors } from 'hono/cors'

import { statsRoutes } from './routes/stats'

const api = new OpenAPIHono()
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

const app = new OpenAPIHono().route('/api', api)

export type AppType = typeof api

export default app
