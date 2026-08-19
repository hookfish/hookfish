import {
  accessGrants,
  brokerAccessTokens,
  connections,
  type Database,
  type DatabaseBinding,
  defineDatabase,
  drizzleDatabase,
  oauthStates,
} from '@hookfish/api/database'
import { migrationsFolder } from '@hookfish/api/migrations'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgresClient from 'postgres'

const schema = {
  accessGrants,
  brokerAccessTokens,
  connections,
  oauthStates,
}
export type PostgresConnection<Bindings extends object> =
  | string
  | ((bindings: Bindings) => string)

export type PostgresDatabaseOptions = {
  /** Reuse clients by connection string. Disable this in request-isolated runtimes. */
  cache?: boolean
  /** Skip Postgres type discovery when array types are not used. */
  fetchTypes?: boolean
  max?: number
  prepare?: boolean
}

/**
 * Creates a cached database binding for a Postgres connection string.
 *
 * A resolver can read host bindings at request time. That keeps runtime-owned
 * connection details outside Hookfish and is the extension point for a future
 * Hyperdrive-specific adapter.
 */
export function postgres<Bindings extends object = object>(
  connection: PostgresConnection<Bindings>,
  options: PostgresDatabaseOptions = {},
): DatabaseBinding<Bindings> {
  const databases = new Map<string, Database>()

  const getConnectionString = (bindings: Bindings) => {
    const connectionString =
      typeof connection === 'function' ? connection(bindings) : connection
    const normalized = connectionString.trim()

    if (!normalized) {
      throw new Error('Postgres connection string cannot be empty.')
    }

    return normalized
  }

  const createDatabase = (connectionString: string) => {
    const client = postgresClient(connectionString, {
      fetch_types: options.fetchTypes ?? true,
      max: options.max ?? 10,
      prepare: options.prepare ?? true,
    })
    return { client, database: drizzle(client, { schema }) }
  }

  const getDatabase = (bindings: Bindings) => {
    const connectionString = getConnectionString(bindings)

    if (options.cache !== false) {
      const existing = databases.get(connectionString)
      if (existing) return existing
    }

    const { database: drizzleClient } = createDatabase(connectionString)
    const database = drizzleDatabase(drizzleClient)
    if (options.cache !== false) databases.set(connectionString, database)
    return database
  }

  return defineDatabase(getDatabase, async (bindings) => {
    const { client, database } = createDatabase(getConnectionString(bindings))
    try {
      await migrate(database, { migrationsFolder: migrationsFolder() })
    } finally {
      await client.end()
    }
  })
}
