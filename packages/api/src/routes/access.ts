import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import type { DatabaseInput } from '../db/binding.js'
import { isBrokerError } from '../oauth/errors.js'
import {
  type BrokerContext,
  requireApiKey,
  withDatabase,
} from '../oauth/middleware.js'

const accessContextRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'access.get',
  summary: 'Describe the current broker access grant',
  security: [{ brokerApiKey: [] }],
  responses: {
    200: {
      description: 'Safe metadata for the presented root or scoped token',
      content: {
        'application/json': {
          schema: z.object({
            kind: z.enum(['root', 'scoped']),
            scopes: z.array(z.string()),
            name: z.string().optional(),
            expires_at: z.iso.datetime().optional(),
          }),
        },
      },
    },
    401: {
      description: 'Missing or invalid broker credential',
      content: {
        'application/json': {
          schema: z.object({
            error: z.object({ code: z.string(), message: z.string() }),
          }),
        },
      },
    },
  },
})

/** Describe the grant carried by the current root or downscoped API token. */
export function createAccessRoutes<Bindings extends object>(
  database: DatabaseInput<Bindings>,
) {
  const app = new OpenAPIHono<BrokerContext<Bindings>>()
  app.use('*', withDatabase(database))
  app.use('*', requireApiKey<Bindings>())
  app.openapi(accessContextRoute, (context) => {
    const grant = context.get('accessGrant')
    return context.json(
      {
        kind: grant.kind,
        scopes: grant.scopes,
        ...(grant.kind === 'scoped'
          ? {
              name: grant.name,
              expires_at: new Date(grant.expiresAt).toISOString(),
            }
          : {}),
      },
      200,
    )
  })
  app.onError((error, context) => {
    if (isBrokerError(error)) {
      return context.json(
        { error: { code: error.code, message: error.message } },
        error.status,
      )
    }
    console.error(error)
    return context.json(
      { error: { code: 'internal_error', message: 'Internal server error.' } },
      500,
    )
  })
  return app
}
