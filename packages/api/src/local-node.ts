import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { createPgliteDatabase } from './db/pglite'
import type { BrokerEnv } from './oauth/config'

/**
 * Node-only bootstrap for local PGlite. Used by `apps/server` and the
 * frontend Vite plugin so `/api` can persist without DATABASE_URL.
 * Must never be imported from a Worker entrypoint.
 */
const apiPackageRoot = path.resolve(fileURLToPath(import.meta.url), '../..')

export async function createLocalBrokerEnv(
  dataDir: string,
): Promise<BrokerEnv> {
  const { db } = await createPgliteDatabase(dataDir)

  await migrate(db, {
    migrationsFolder: path.join(apiPackageRoot, 'drizzle'),
  })

  return { ...process.env, DB: db }
}
