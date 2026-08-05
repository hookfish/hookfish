import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineHookfishConfig, z } from '@hookfish/api'
import { pglite } from '@hookfish/database/pglite'
import {
  GitHubProvider,
  LinearProvider,
  NotionProvider,
} from '@hookfish/providers'

const configSchema = z.object({
  GITHUB_CLIENT_ID: z
    .string()
    .optional()
    .prefault(process.env.GITHUB_CLIENT_ID!),
  GITHUB_CLIENT_SECRET: z
    .string()
    .optional()
    .prefault(process.env.GITHUB_CLIENT_SECRET!),
})

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

export default defineHookfishConfig({
  config: configSchema,
  db,
  // swaggerUi: false, // Disable interactive docs; OpenAPI remains available.
  returnTo: 'http://localhost:5173',
  trustedOrigins: ['http://localhost:5173'], // Allow per-flow return paths on these origins.
  // organizationRouting: true, // Use /api/:organization/oauth management routes.
  // onEvent: async (event) => auditLog.write(event),
  providers: (config) => ({
    // Providers can receive credentials explicitly from validated config.
    github: new GitHubProvider({
      clientId: config.GITHUB_CLIENT_ID,
      clientSecret: config.GITHUB_CLIENT_SECRET,
    }),
    // Or retain their conventional <PROVIDER>_CLIENT_ID / _CLIENT_SECRET
    // environment lookup when constructor credentials are omitted.
    linear: new LinearProvider(),
    notion: new NotionProvider(),
  }),
})
