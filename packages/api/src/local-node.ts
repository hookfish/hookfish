import { createPgliteDatabase } from './db/pglite'
import { createPostgresDatabase } from './db/postgres'
import type { BrokerEnv } from './oauth/config'

/**
 * Node-only bootstrap. Used by `apps/server` and the frontend Vite plugin.
 * Must never be imported from a Worker entrypoint.
 *
 * Stock Node (real Postgres): set `DATABASE_URL` — builds a pooled postgres.js
 * client and injects it as `env.DB`.
 *
 * Embedded (no Postgres to provision): leave `DATABASE_URL` unset — PGlite
 * persists under `dataDir` and is injected as `env.DB`.
 *
 * Run migrations separately (`pnpm migrate` / `db:migrate`) before starting.
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
    const db = createPostgresDatabase(databaseUrl, 'node')
    return { ...process.env, DB: db }
  }

  const { db } = await createPgliteDatabase(dataDir)
  return { ...process.env, DB: db }
}
