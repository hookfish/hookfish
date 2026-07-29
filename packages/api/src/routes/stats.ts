import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'

const statsResponseSchema = z
  .object({
    region: z.string().openapi({ example: 'SJC' }),
    uptimeMode: z.string().openapi({ example: 'per-request isolate' }),
    features: z.array(z.string()).openapi({
      example: ['Hono API', 'React Query', 'TanStack Start', 'Workers SSR'],
    }),
  })
  .openapi('StatsResponse')

const statsRoute = createRoute({
  method: 'get',
  path: '/',
  summary: 'Read Worker runtime stats',
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
  const region =
    typeof c.req.raw.cf?.colo === 'string' ? c.req.raw.cf.colo : 'local'

  return c.json(
    {
      region,
      uptimeMode: 'per-request isolate',
      features: ['Hono API', 'React Query', 'TanStack Start', 'Workers SSR'],
    },
    200,
  )
})
