import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hookfish } from '@hookfish/api'
import { pglite } from '@hookfish/database/pglite'
import {
  GitHubProvider,
  LinearProvider,
  NotionProvider,
} from '@hookfish/providers'

const db = pglite(
  process.env.PGLITE_DATA_DIR ??
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'pgdata'),
)

// To use Postgres instead:
// import { postgres } from '@hookfish/database/postgres'
// const db = postgres(process.env.DATABASE_URL ?? '')

// On Cloudflare Workers, use Hyperdrive instead:
// import { postgres } from '@hookfish/database/postgres'
// const db = postgres<{ HYPERDRIVE: { connectionString: string } }>(
//   (bindings) => bindings.HYPERDRIVE.connectionString,
//   { cache: false, fetchTypes: false, max: 5, prepare: true },
// )

export default new Hookfish({
  db,
  providers: {
    github: new GitHubProvider(),
    linear: new LinearProvider(),
    notion: new NotionProvider(),
  },
})
