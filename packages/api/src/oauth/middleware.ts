import { createMiddleware } from 'hono/factory'
import {
  type DatabaseContext,
  type DatabaseInput,
  resolveDatabase,
} from '../db/binding'
import type { Database } from '../db/schema'
import { type AccessGrant, authenticateAccessToken } from './access-token'
import { requireBrokerApiKey, resolveBrokerConfig } from './config'
import { safeEqual } from './crypto'
import { BrokerError } from './errors'

export type BrokerContext<Bindings extends object = object> = {
  Bindings: Bindings
  Variables: {
    db: Database
    databaseContext: DatabaseContext
    accessGrant: AccessGrant
  }
}

type DatabaseContextRequest = {
  param(name: string): string | undefined
  query(name: string): string | undefined
}

type ResolveDatabaseContext<Bindings extends object> = (
  request: DatabaseContextRequest,
  bindings: Bindings,
) => DatabaseContext | Promise<DatabaseContext>

/**
 * Resolves the database for the request.
 *
 * The binding is supplied when Hookfish is constructed. It may be a ready
 * Drizzle database or a runtime-aware binding that resolves from `c.env`.
 */
export function withDatabase<Bindings extends object>(
  database: DatabaseInput<Bindings>,
  resolveContext: ResolveDatabaseContext<Bindings> = () => ({}),
) {
  return createMiddleware<BrokerContext<Bindings>>(async (c, next) => {
    const context = await resolveContext(c.req, c.env)
    c.set('databaseContext', context)
    c.set('db', await resolveDatabase(database, c.env, context))
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
    const expected = requireBrokerApiKey(resolveBrokerConfig(c.env))
    const header = c.req.header('Authorization') ?? ''
    const presented = header.startsWith('Bearer ') ? header.slice(7) : ''

    if (!presented) {
      throw new BrokerError(
        401,
        'unauthorized',
        'Missing Authorization header. Send: Authorization: Bearer <token>',
      )
    }

    const accessGrant: AccessGrant = safeEqual(presented, expected)
      ? { kind: 'root', scopes: ['**'] }
      : await authenticateAccessToken(c.get('db'), expected, presented)

    c.set('accessGrant', accessGrant)

    await next()
  })
}
