import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pglite } from '@hookfish/database/pglite'
import { createHookfishConfig } from './hookfish.shared'

const db = pglite(
  process.env.PGLITE_DATA_DIR ??
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'pgdata'),
)

// To use Postgres instead:
// import { postgres } from '@hookfish/database/postgres'
// const db = postgres(process.env.DATABASE_URL ?? '')

// The Cloudflare Worker supplies Hyperdrive in its own hookfish.config.ts so
// both runtime variants can run without changing this Node configuration.

export default createHookfishConfig({
  db,
})
