import { createMiddleware } from 'hono/factory'
import { type DatabaseInput, resolveDatabase } from '../db/binding'
import type { Database } from '../db/schema'
import { requireBrokerApiKey } from './config'
import { safeEqual } from './crypto'
import { BrokerError } from './errors'

export type BrokerContext<Bindings extends object = object> = {
  Bindings: Bindings
  Variables: { db: Database }
}

/**
 * Resolves the database for the request.
 *
 * The binding is supplied when Hookfish is constructed. It may be a ready
 * Drizzle database or a runtime-aware binding that resolves from `c.env`.
 */
export function withDatabase<Bindings extends object>(
  database: DatabaseInput<Bindings>,
) {
  return createMiddleware<BrokerContext<Bindings>>(async (c, next) => {
    c.set('db', await resolveDatabase(database, c.env))
    await next()
  })
}

/**
 * Guards every endpoint that can mint an authorization or read a token.
 * The OAuth callback is deliberately exempt: it is hit by the user's browser
 * and is authenticated instead by the single-use `state` value.
 */
export function requireApiKey<Bindings extends object>() {
  return createMiddleware<BrokerContext<Bindings>>(async (c, next) => {
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
  })
}
