import type { NeonHttpDatabase } from 'drizzle-orm/neon-http'
import type { PgliteDatabase } from 'drizzle-orm/pglite'
import type * as schema from './schema'

/**
 * The broker only ever uses the subset of Drizzle that both drivers implement,
 * so route code is written once and runs on either.
 */
export type Database =
  | NeonHttpDatabase<typeof schema>
  | PgliteDatabase<typeof schema>
