import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'

const statsResponseSchema = z
  .object({
    region: z.string().openapi({ example: 'SJC' }),
    uptimeMode: z.string().openapi({ example: 'per-request isolate' }),
    features: z.array(z.string()).openapi({
      example: ['Hono API', 'React Query', 'TanStack Start', 'Node SSR'],
    }),
  })
  .openapi('StatsResponse')

const statsRoute = createRoute({
  method: 'get',
  path: '/',
  summary: 'Read Node runtime stats',
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
  return c.json(
    {
      region: process.env.REGION ?? 'local',
      uptimeMode: 'long-lived process',
      features: ['Hono API', 'React Query', 'TanStack Start', 'Node SSR'],
    },
    200,
  )
})
