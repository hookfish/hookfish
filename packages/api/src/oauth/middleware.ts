import { createMiddleware } from 'hono/factory'
import { createPostgresDatabase } from '../db/postgres'
import { resolveDatabaseSource } from '../db/resolve'
import type { Database } from '../db/schema'
import { type BrokerEnv, requireBrokerApiKey } from './config'
import { safeEqual } from './crypto'
import { BrokerError } from './errors'

export type BrokerContext = {
  Bindings: BrokerEnv
  Variables: { db: Database }
}

/**
 * Resolves the database for the request.
 *
 * Configure one of (priority order):
 * 1. `env.DB` — inject a ready Drizzle instance (PGlite, or a
 *    host-built postgres.js pool)
 * 2. `env.DATABASE_URL` — stock Postgres URL
 */
export const withDatabase = createMiddleware<BrokerContext>(async (c, next) => {
  const source = resolveDatabaseSource(c.env)

  if (!source) {
    throw new BrokerError(
      500,
      'missing_configuration',
      'No database configured. Inject env.DB or set DATABASE_URL.',
    )
  }

  if (source.kind === 'injected') {
    c.set('db', source.db)
  } else {
    c.set('db', createPostgresDatabase(source.connectionString))
  }

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
