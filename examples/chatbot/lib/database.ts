import path from 'node:path'
import {
  brokerAccessTokens,
  drizzleDatabase,
  oauthConnections,
  oauthProviders,
  oauthStates,
  vaultSecrets,
} from '@hookfish/api/database'
import { migrationsFolder as hookfishMigrationsFolder } from '@hookfish/api/migrations'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

import * as authSchema from '@/lib/auth-schema'

const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required. Start this example with its dev, build, or start script so the PGlite socket server is available.',
  )
}

const sqlKey = Symbol.for('@hookfish/example-chatbot/postgres-client')
const existingSql = Reflect.get(globalThis, sqlKey)

function isPostgresClient(
  value: unknown,
): value is ReturnType<typeof postgres> {
  return typeof value === 'function' && Reflect.has(value, 'end')
}

export const sqlClient = isPostgresClient(existingSql)
  ? existingSql
  : postgres(databaseUrl, {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
    })

if (!isPostgresClient(existingSql)) {
  Reflect.set(globalThis, sqlKey, sqlClient)
}

const hookfishSchema = {
  brokerAccessTokens,
  oauthConnections,
  oauthProviders,
  oauthStates,
  vaultSecrets,
}

export const authDatabase = drizzle(sqlClient, { schema: authSchema })
const hookfishDrizzle = drizzle(sqlClient, { schema: hookfishSchema })

export const hookfishDatabase = drizzleDatabase(hookfishDrizzle)

export async function migrateDatabases() {
  await migrate(hookfishDrizzle, {
    migrationsFolder: hookfishMigrationsFolder(),
    migrationsTable: '__hookfish_migrations',
  })
  await migrate(authDatabase, {
    migrationsFolder: path.join(process.cwd(), 'drizzle'),
    migrationsTable: '__better_auth_migrations',
  })
}

// The package scripts run migrations before Next starts accepting requests.
export const databaseReady = Promise.resolve()
