import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineHookfishConfig } from '@hookfish/api'
import { pglite } from '@hookfish/database/pglite'
import {
  createGitHubProvider,
  createLinearProvider,
  createMcpProvider,
  createNotionProvider,
} from '@hookfish/providers'

const frontendUrl = process.env.HOOKFISH_FRONTEND_URL ?? 'http://127.0.0.1:5173'

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
  db,
  includeClient: true,
  includeSwagger: true,
  returnTo: frontendUrl,
  trustedOrigins: [frontendUrl], // Allow per-flow return paths on this origin.
  organizationRouting: false, // Use /api/organization/:organization/oauth management routes.
  providerManagement: true,
  // onEvent: async (event) => auditLog.write(event),
  providers: (env: typeof process.env) => ({
    // Provider factories receive the bindings passed to Hookfish.fetch.
    github: createGitHubProvider({
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    }),
    linear: createLinearProvider({
      clientId: env.LINEAR_CLIENT_ID,
      clientSecret: env.LINEAR_CLIENT_SECRET,
    }),
    mcp: createMcpProvider(),
    notion: createNotionProvider({
      clientId: env.NOTION_CLIENT_ID,
      clientSecret: env.NOTION_CLIENT_SECRET,
    }),
  }),
})
