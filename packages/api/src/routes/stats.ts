import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'

const statsResponseSchema = z
  .object({
    region: z.string().openapi({ example: 'SJC' }),
    uptimeMode: z.string().openapi({ example: 'per-request isolate' }),
    features: z.array(z.string()).openapi({
      example: ['Hookfish API', 'Fetch-compatible runtime'],
    }),
  })
  .openapi('StatsResponse')

const statsRoute = createRoute({
  method: 'get',
  path: '/',
  summary: 'Read runtime stats',
  responses: {
    200: {
      description: 'Runtime metadata',
      content: {
        'application/json': {
          schema: statsResponseSchema,
        },
      },
    },
  },
})

export const statsRoutes = new OpenAPIHono().openapi(statsRoute, (c) => {
  const configuredRegion = Reflect.get(c.env ?? {}, 'REGION')

  return c.json(
    {
      region: typeof configuredRegion === 'string' ? configuredRegion : 'local',
      uptimeMode: 'fetch handler',
      features: ['Hookfish API', 'Fetch-compatible runtime'],
    },
    200,
  )
})
