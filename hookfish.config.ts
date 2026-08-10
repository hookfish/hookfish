import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineHookfishConfig, z } from '@hookfish/api'
import { pglite } from '@hookfish/database/pglite'
import {
  createGitHubProvider,
  createLinearProvider,
  createNotionProvider,
} from '@hookfish/providers'

const frontendUrl = process.env.HOOKFISH_FRONTEND_URL ?? 'http://127.0.0.1:5173'

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

// On Cloudflare Workers, override the default with Hyperdrive instead:
// import { postgres } from '@hookfish/database/postgres'
// const cloudflareDb = postgres<{ HYPERDRIVE: { connectionString: string } }>(
//   (bindings) => bindings.HYPERDRIVE.connectionString,
//   { cache: false, fetchTypes: false, max: 5, prepare: true },
// )
// const hookfish = await Hookfish.init({ ...config, db: cloudflareDb })

export default defineHookfishConfig({
  config: configSchema,
  db,
  includeClient: true,
  includeSwagger: true,
  returnTo: frontendUrl,
  trustedOrigins: [frontendUrl], // Allow per-flow return paths on this origin.
  organizationRouting: false, // Use /api/organization/:organization/oauth management routes.
  providerManagement: true,
  // onEvent: async (event) => auditLog.write(event),
  providers: (config) => ({
    // Providers can receive credentials explicitly from validated config.
    github: createGitHubProvider({
      clientId: config.GITHUB_CLIENT_ID,
      clientSecret: config.GITHUB_CLIENT_SECRET,
    }),
    // Or retain their conventional <PROVIDER>_CLIENT_ID / _CLIENT_SECRET
    // environment lookup when constructor credentials are omitted.
    linear: createLinearProvider(),
    notion: createNotionProvider(),
  }),
})
