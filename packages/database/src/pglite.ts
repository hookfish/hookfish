import { PGlite } from '@electric-sql/pglite'
import {
  brokerAccessTokens,
  type Database,
  type DatabaseBinding,
  defineDatabase,
  oauthConnections,
  oauthStates,
} from '@hookfish/api/database'
import { migrationsFolder as bundledMigrations } from '@hookfish/api/migrations'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'

const schema = { brokerAccessTokens, oauthConnections, oauthStates }

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
  const resolveMigrationsFolder = () =>
    options.migrationsFolder ?? bundledMigrations()

  const migrateClient = async (client: PGlite) => {
    const migrationsFolder = resolveMigrationsFolder()
    if (migrationsFolder !== false) {
      await migrate(drizzle(client, { schema }), { migrationsFolder })
    }
  }

  const getDatabase = () => {
    pending ??= (async () => {
      const client = new PGlite(dataDir)
      await client.waitReady
      await migrateClient(client)
      return drizzle(client, { schema })
    })()

    return pending
  }

  return defineDatabase(getDatabase, async () => {
    if (pending) {
      await pending
      return
    }

    const client = new PGlite(dataDir)
    try {
      await client.waitReady
      await migrateClient(client)
    } finally {
      await client.close()
    }
  })
}
