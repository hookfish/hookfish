import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema'

/**
 * HTTP Postgres driver. This is the path used inside Cloudflare Workers, where
 * there is no TCP socket pool to keep warm. Any Postgres reachable over the
 * Neon HTTP protocol works; set DATABASE_URL to point at it.
 */
export function createNeonDatabase(databaseUrl: string) {
  return drizzle(neon(databaseUrl), { schema })
}
