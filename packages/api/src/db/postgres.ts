import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

/**
 * Build a Drizzle client against any standard Postgres connection string.
 */
export function createPostgresDatabase(connectionString: string) {
  const client = postgres(connectionString, {
    max: 10,
    prepare: true,
  })

  return drizzle(client, { schema })
}
