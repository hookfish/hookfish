import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import * as schema from './schema'

/**
 * Node-only. PGlite's persistent filesystems (Node FS, IndexedDB, OPFS) are all
 * Used by Node entrypoints for a zero-configuration local database.
 */
export async function createPgliteDatabase(dataDir: string) {
  const client = new PGlite(dataDir)
  await client.waitReady

  return { client, db: drizzle(client, { schema }) }
}
