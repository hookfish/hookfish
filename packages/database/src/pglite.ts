import { PGlite } from '@electric-sql/pglite'
import {
  accessGrants,
  brokerAccessTokens,
  connections,
  type Database,
  type DatabaseBinding,
  type DrizzleDatabase,
  defineDatabase,
  drizzleDatabase,
  oauthStates,
} from '@hookfish/api/database'
import { migrationsFolder as bundledMigrations } from '@hookfish/api/migrations'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'

const schema = {
  accessGrants,
  brokerAccessTokens,
  connections,
  oauthStates,
}

export type PgliteDatabaseOptions = {
  /** Override the bundled Hookfish migrations, or set false to skip them. */
  migrationsFolder?: string | false
}

export interface PgliteDatabaseBinding<Bindings extends object = object>
  extends DatabaseBinding<Bindings> {
  /** The underlying Drizzle client, primarily for migrations and test tooling. */
  getDrizzleDatabase(bindings: Bindings): Promise<DrizzleDatabase>
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
): PgliteDatabaseBinding<Bindings> {
  let pending:
    | Promise<{
        database: Database
        drizzle: DrizzleDatabase
      }>
    | undefined
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
      const drizzleClient = drizzle(client, { schema })
      return {
        database: drizzleDatabase(drizzleClient),
        drizzle: drizzleClient,
      }
    })()

    return pending
  }

  const binding = defineDatabase(
    async () => (await getDatabase()).database,
    async () => {
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
    },
  )

  return {
    ...binding,
    getDrizzleDatabase: async () => (await getDatabase()).drizzle,
  }
}
