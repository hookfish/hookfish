import {
  type Database,
  type DatabaseBinding,
  defineDatabase,
  oauthConnections,
  oauthStates,
} from '@template/api/database'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgresClient from 'postgres'

const schema = { oauthConnections, oauthStates }

export type PostgresConnection<Bindings extends object> =
  | string
  | ((bindings: Bindings) => string)

export type PostgresDatabaseOptions = {
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

  return defineDatabase((bindings) => {
    const connectionString =
      typeof connection === 'function' ? connection(bindings) : connection
    const normalized = connectionString.trim()

    if (!normalized) {
      throw new Error('Postgres connection string cannot be empty.')
    }

    const existing = databases.get(normalized)
    if (existing) return existing

    const client = postgresClient(normalized, {
      max: options.max ?? 10,
      prepare: options.prepare ?? true,
    })
    const database = drizzle(client, { schema })
    databases.set(normalized, database)
    return database
  })
}
