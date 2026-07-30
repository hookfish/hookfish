import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

/**
 * How the TCP client should behave.
 *
 * - `node`: long-lived process, real connection pool.
 * - `worker`: Cloudflare Workers / Hyperdrive — tiny pool, no prepared
 *   statements (transaction-mode poolers reject them).
 */
export type PostgresClientMode = 'node' | 'worker'

/**
 * Build a Drizzle client against any standard Postgres connection string.
 *
 * Prefer injecting the result as `env.DB` from a Node entrypoint (so the pool
 * lives for the process). On Workers, the OAuth middleware builds one per
 * request from `env.HYPERDRIVE` or `env.DATABASE_URL`.
 */
export function createPostgresDatabase(
  connectionString: string,
  mode: PostgresClientMode = 'worker',
) {
  const client = postgres(connectionString, {
    max: mode === 'node' ? 10 : 1,
    prepare: mode !== 'worker',
    // Skip pg_catalog type discovery over the edge; Hyperdrive docs recommend
    // this. Harmless for plain DATABASE_URL on Workers too.
    ...(mode === 'worker' ? { fetch_types: false as const } : {}),
  })

  return drizzle(client, { schema })
}
