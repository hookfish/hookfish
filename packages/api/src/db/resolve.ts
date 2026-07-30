import { z } from 'zod'
import type { Database } from './schema'

const nonEmptyString = z.string().trim().min(1)

const hyperdriveBindingSchema = z.object({
  connectionString: nonEmptyString,
})

/**
 * Minimal shape of a Cloudflare Hyperdrive binding. Declared here so Node
 * consumers do not need `@cloudflare/workers-types` at runtime — only the
 * `connectionString` field is required.
 */
export type HyperdriveBinding = z.infer<typeof hyperdriveBindingSchema>

export type DatabaseSource =
  | { kind: 'injected'; db: Database }
  | { kind: 'hyperdrive'; connectionString: string }
  | { kind: 'database_url'; connectionString: string }

/** Injected Drizzle instance — any non-null object that is not a Hyperdrive binding. */
const injectedDatabaseSchema = z
  .custom<Database>((value) => typeof value === 'object' && value !== null)
  .refine((value) => !hyperdriveBindingSchema.safeParse(value).success)

/**
 * Pick a database source for the request.
 *
 * Priority (first match wins):
 * 1. `env.DB` — injected Drizzle instance (Node + PGlite, or a host-built pool)
 * 2. `env.HYPERDRIVE` — Cloudflare Hyperdrive binding
 * 3. `env.DATABASE_URL` — stock Postgres connection string (Node or Workers)
 */
export function resolveDatabaseSource(env: {
  DB?: unknown
  HYPERDRIVE?: unknown
  DATABASE_URL?: unknown
}): DatabaseSource | undefined {
  const injected = injectedDatabaseSchema.safeParse(env.DB)
  if (injected.success) {
    return { kind: 'injected', db: injected.data }
  }

  const hyperdrive = hyperdriveBindingSchema.safeParse(env.HYPERDRIVE)
  if (hyperdrive.success) {
    return {
      kind: 'hyperdrive',
      connectionString: hyperdrive.data.connectionString,
    }
  }

  const databaseUrl = nonEmptyString.safeParse(env.DATABASE_URL)
  if (databaseUrl.success) {
    return { kind: 'database_url', connectionString: databaseUrl.data }
  }

  return undefined
}
