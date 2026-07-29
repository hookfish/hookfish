import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import * as schema from './schema'

/**
 * Node-only. PGlite's persistent filesystems (Node FS, IndexedDB, OPFS) are all
 * unavailable inside workerd, so this module must never be pulled into the
 * Worker bundle -- it is imported exclusively from `src/node.ts`.
 */
export function createPgliteDatabase(dataDir: string) {
  const client = new PGlite(dataDir)

  return { client, db: drizzle(client, { schema }) }
}
