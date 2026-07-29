import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import * as schema from './schema'

/**
 * Node-only. PGlite's persistent filesystems (Node FS, IndexedDB, OPFS) are all
 * unavailable inside workerd, so this module must never be pulled into the
 * Worker bundle -- it is imported from Node entrypoints only
 * (`apps/server/src/node.ts`, `@template/api/local-node`, frontend Vite plugin).
 */
export async function createPgliteDatabase(dataDir: string) {
  const client = new PGlite(dataDir)
  await client.waitReady

  return { client, db: drizzle(client, { schema }) }
}
