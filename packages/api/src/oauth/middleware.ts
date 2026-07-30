import { createMiddleware } from 'hono/factory'
import { createNeonDatabase } from '../db/neon'
import type { Database } from '../db/schema'
import { type BrokerEnv, readEnvString, requireBrokerApiKey } from './config'
import { safeEqual } from './crypto'
import { BrokerError } from './errors'

export type BrokerContext = {
  Bindings: BrokerEnv
  Variables: { db: Database }
}

/**
 * Resolves the database for the request. Local Node entrypoints (standalone
 * server and the frontend Vite `/api` plugin) inject a live PGlite instance as
 * `env.DB`; deployed Workers build an HTTP client per request from DATABASE_URL.
 */
export const withDatabase = createMiddleware<BrokerContext>(async (c, next) => {
  const injected = c.env.DB

  if (injected !== undefined && typeof injected !== 'string') {
    c.set('db', injected)
    await next()
    return
  }

  const databaseUrl = readEnvString(c.env, 'DATABASE_URL')

  if (!databaseUrl) {
    throw new BrokerError(
      500,
      'missing_configuration',
      'DATABASE_URL is not set. Set it for deployed Workers. Locally, `pnpm dev` and `pnpm --filter @template/server dev` use PGlite.',
    )
  }

  c.set('db', createNeonDatabase(databaseUrl))
  await next()
})

/**
 * Guards every endpoint that can mint an authorization or read a token.
 * The OAuth callback is deliberately exempt: it is hit by the user's browser
 * and is authenticated instead by the single-use `state` value.
 */
export const requireApiKey = createMiddleware<BrokerContext>(
  async (c, next) => {
    const expected = requireBrokerApiKey(c.env)
    const header = c.req.header('Authorization') ?? ''
    const presented = header.startsWith('Bearer ') ? header.slice(7) : ''

    if (!presented || !safeEqual(presented, expected)) {
      throw new BrokerError(
        401,
        'unauthorized',
        'Missing or invalid Authorization header. Send: Authorization: Bearer $BROKER_API_KEY',
      )
    }

    await next()
  },
)
