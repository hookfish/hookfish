import { createPgliteDatabase } from './db/pglite'
import { createPostgresDatabase } from './db/postgres'
import type { BrokerEnv } from './oauth/config'
import { bootstrapProviderCredentialsFromEnv } from './oauth/providers'

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
 *
 * If seeded provider rows still lack credentials but matching
 * `<ID>_CLIENT_ID` / `_SECRET` env vars exist, they are encrypted into the DB
 * once here so both Node and Vite local paths share the cutover behavior.
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

  const env: BrokerEnv = databaseUrl
    ? { ...process.env, DB: createPostgresDatabase(databaseUrl, 'node') }
    : {
        ...process.env,
        DB: (await createPgliteDatabase(dataDir)).db,
      }

  if (env.DB) {
    const bootstrapped = await bootstrapProviderCredentialsFromEnv(env.DB, env)
    if (bootstrapped.length > 0) {
      console.log(
        `Bootstrapped provider credentials from env: ${bootstrapped.join(', ')}`,
      )
    }
  }

  return env
}
