import { PGlite } from '@electric-sql/pglite'
import {
  type Database,
  type DatabaseBinding,
  defineDatabase,
  oauthConnections,
  oauthStates,
} from '@hookfish/api/database'
import { migrationsFolder as bundledMigrations } from '@hookfish/api/migrations'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'

const schema = { oauthConnections, oauthStates }

export type PgliteDatabaseOptions = {
  /** Override the bundled Hookfish migrations, or set false to skip them. */
  migrationsFolder?: string | false
}

/**
 * Creates a lazy, process-local PGlite database binding.
 *
 * Initialization and migrations run once, on the first request that needs the
 * database. This keeps construction synchronous like the other adapters.
 */
export function pglite<Bindings extends object = object>(
  dataDir: string,
  options: PgliteDatabaseOptions = {},
): DatabaseBinding<Bindings> {
  let pending: Promise<Database> | undefined

  return defineDatabase(() => {
    pending ??= (async () => {
      const client = new PGlite(dataDir)
      await client.waitReady
      const database = drizzle(client, { schema })
      const migrationsFolder = options.migrationsFolder ?? bundledMigrations

      if (migrationsFolder !== false) {
        await migrate(database, { migrationsFolder })
      }

      return database
    })()

    return pending
  })
}
