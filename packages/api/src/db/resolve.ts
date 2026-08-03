import { z } from 'zod'
import type { Database } from './schema'

const nonEmptyString = z.string().trim().min(1)

export type DatabaseSource =
  | { kind: 'injected'; db: Database }
  | { kind: 'database_url'; connectionString: string }

/** Injected Drizzle instance — any non-null object. */
const injectedDatabaseSchema = z.custom<Database>(
  (value) => typeof value === 'object' && value !== null,
)

/**
 * Pick a database source for the request.
 *
 * Priority (first match wins):
 * 1. `env.DB` — injected Drizzle instance (PGlite or a host-built pool)
 * 2. `env.DATABASE_URL` — stock Postgres connection string
 */
export function resolveDatabaseSource(env: {
  DB?: unknown
  DATABASE_URL?: unknown
}): DatabaseSource | undefined {
  const injected = injectedDatabaseSchema.safeParse(env.DB)
  if (injected.success) {
    return { kind: 'injected', db: injected.data }
  }

  const databaseUrl = nonEmptyString.safeParse(env.DATABASE_URL)
  if (databaseUrl.success) {
    return { kind: 'database_url', connectionString: databaseUrl.data }
  }

  return undefined
}
