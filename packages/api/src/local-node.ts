import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { createPgliteDatabase } from './db/pglite'
import { createPostgresDatabase } from './db/postgres'
import type { BrokerEnv } from './oauth/config'

/**
 * Node-only bootstrap. Used by `apps/server` and the frontend Node server.
 * Keep this out of browser bundles; it relies on Node filesystem persistence.
 *
 * Stock Node (real Postgres): set `DATABASE_URL` — builds a pooled postgres.js
 * client and injects it as `env.DB`.
 *
 * Embedded (no Postgres to provision): leave `DATABASE_URL` unset — PGlite
 * persists under `dataDir` and is injected as `env.DB`.
 *
 * The embedded database is migrated on startup. Hosted Postgres migrations
 * remain an explicit deployment step.
 */
export type LocalBrokerOptions = {
  /** Override `process.env.DATABASE_URL`. Empty / omitted falls back to PGlite. */
  databaseUrl?: string
}

export async function createLocalBrokerEnv(
  dataDir: string,
  options: LocalBrokerOptions = {},
): Promise<BrokerEnv> {
  const databaseUrl = (options.databaseUrl ?? process.env.DATABASE_URL)?.trim()

  if (databaseUrl) {
    const db = createPostgresDatabase(databaseUrl)
    return { ...process.env, DB: db }
  }

  const { db } = await createPgliteDatabase(dataDir)
  const migrationsFolder = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../drizzle',
  )
  await migrate(db, { migrationsFolder })
  return { ...process.env, DB: db }
}
