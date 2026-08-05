import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { asc, lte } from 'drizzle-orm'
import type { DatabaseInput } from '../db/binding'
import { brokerAccessTokens } from '../db/schema'
import {
  assertCanDelegate,
  assertRootAccess,
  DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
  MAX_ACCESS_TOKEN_TTL_SECONDS,
  mintAccessToken,
  normalizeTokenName,
} from '../oauth/access-token'
import { requireBrokerApiKey } from '../oauth/config'
import { BrokerError, isBrokerError } from '../oauth/errors'
import {
  type BrokerContext,
  requireApiKey,
  withDatabase,
} from '../oauth/middleware'

const brokerAuth = [{ brokerApiKey: [] }]

const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
})

const errors = {
  400: {
    description: 'Invalid request',
    content: { 'application/json': { schema: errorSchema } },
  },
  401: {
    description: 'Missing or invalid broker credential',
    content: { 'application/json': { schema: errorSchema } },
  },
  403: {
    description: 'The credential cannot perform this administrative action',
    content: { 'application/json': { schema: errorSchema } },
  },
  409: {
    description: 'The token name is already in use',
    content: { 'application/json': { schema: errorSchema } },
  },
  500: {
    description: 'The broker is misconfigured',
    content: { 'application/json': { schema: errorSchema } },
  },
}

const mintTokenRoute = createRoute({
  method: 'post',
  path: '/tokens',
  summary: 'Mint a named broker access token',
  description:
    'Creates an expiring named credential for one or more connection folders. Folder paths are canonicalized to `folder/**`. Tokens may delegate only to folders they already hold and may not create a token that outlives them.',
  security: brokerAuth,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z
              .string()
              .min(1)
              .max(128)
              .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
              .openapi({ example: 'team-worker' }),
            scopes: z
              .array(z.string().min(1).max(512))
              .min(1)
              .max(32)
              .openapi({
                description:
                  'Connection folders. Each path is canonicalized to `path/**`.',
                example: ['team'],
              }),
            expires_in: z
              .number()
              .int()
              .min(60)
              .max(MAX_ACCESS_TOKEN_TTL_SECONDS)
              .optional()
              .openapi({
                description:
                  'Lifetime in seconds (default: 3600; max: 30 days).',
                example: DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
              }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Named broker access token',
      content: {
        'application/json': {
          schema: z.object({
            name: z.string(),
            access_token: z.string(),
            token_type: z.literal('Bearer'),
            scopes: z.array(z.string()),
            expires_at: z.string(),
          }),
        },
      },
    },
    ...errors,
  },
})

const listTokensRoute = createRoute({
  method: 'get',
  path: '/tokens',
  summary: 'List active broker access token names',
  description:
    'Requires root access. Returns names only; bearer values, scopes, and expiration metadata are never included.',
  security: brokerAuth,
  responses: {
    200: {
      description: 'Active token names',
      content: {
        'application/json': {
          schema: z.object({ tokens: z.array(z.string()) }),
        },
      },
    },
    ...errors,
  },
})

async function purgeExpiredTokenNames(
  db: BrokerContext['Variables']['db'],
  now: Date,
): Promise<void> {
  await db
    .delete(brokerAccessTokens)
    .where(lte(brokerAccessTokens.expiresAt, now))
}

export function createAdminRoutes<Bindings extends object>(
  database: DatabaseInput<Bindings>,
) {
  const adminRoutes = new OpenAPIHono<BrokerContext<Bindings>>()
  const authenticate = requireApiKey<Bindings>()
  const connectDatabase = withDatabase(database)

  adminRoutes.use('/tokens', authenticate, connectDatabase)

  const mintApi = adminRoutes.openapi(mintTokenRoute, async (c) => {
    const body = c.req.valid('json')
    const name = normalizeTokenName(body.name)
    const expiresIn = body.expires_in ?? DEFAULT_ACCESS_TOKEN_TTL_SECONDS
    const nowMs = Date.now()
    const now = new Date(nowMs)
    const expiresAtSeconds = Math.floor(nowMs / 1000) + expiresIn
    const scopes = assertCanDelegate(
      c.get('accessGrant'),
      body.scopes,
      expiresAtSeconds,
    )
    const minted = await mintAccessToken(
      requireBrokerApiKey(c.env),
      { name, scopes, expiresIn },
      nowMs,
    )

    await purgeExpiredTokenNames(c.get('db'), now)
    const inserted = await c
      .get('db')
      .insert(brokerAccessTokens)
      .values({
        name: minted.name,
        scopes: minted.scopes,
        expiresAt: new Date(minted.expiresAt * 1000),
      })
      .onConflictDoNothing({ target: brokerAccessTokens.name })
      .returning()

    if (inserted.length === 0) {
      throw new BrokerError(
        409,
        'token_name_in_use',
        `An active broker access token named "${name}" already exists.`,
      )
    }

    c.header('Cache-Control', 'no-store')
    c.header('Pragma', 'no-cache')
    return c.json(
      {
        name: minted.name,
        access_token: minted.token,
        token_type: 'Bearer' as const,
        scopes: minted.scopes,
        expires_at: new Date(minted.expiresAt * 1000).toISOString(),
      },
      200,
    )
  })

  const routes = mintApi.openapi(listTokensRoute, async (c) => {
    assertRootAccess(c.get('accessGrant'))
    await purgeExpiredTokenNames(c.get('db'), new Date())
    const tokens = await c
      .get('db')
      .select({ name: brokerAccessTokens.name })
      .from(brokerAccessTokens)
      .orderBy(asc(brokerAccessTokens.name))

    c.header('Cache-Control', 'no-store')
    return c.json({ tokens: tokens.map(({ name }) => name) }, 200)
  })

  routes.onError((error, c) => {
    if (isBrokerError(error)) {
      return c.json(
        { error: { code: error.code, message: error.message } },
        error.status,
      )
    }

    console.error('broker admin error', error)
    return c.json(
      {
        error: { code: 'internal_error', message: 'Unexpected broker error.' },
      },
      500,
    )
  })

  return routes
}
