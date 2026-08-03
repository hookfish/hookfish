import path from 'node:path'
import { Hookfish } from '@template/api'
import { pglite } from '@template/database/pglite'
import {
  GitHubProvider,
  LinearProvider,
  NotionProvider,
} from '@template/providers'

const db = pglite(
  process.env.PGLITE_DATA_DIR ?? path.join(import.meta.dirname, 'pgdata'),
)

// To use Postgres instead:
// import { postgres } from '@template/database/postgres'
// const db = postgres(process.env.DATABASE_URL ?? '')

// On Cloudflare Workers, use Hyperdrive instead:
// import { postgres } from '@template/database/postgres'
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
