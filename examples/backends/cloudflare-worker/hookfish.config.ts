import { defineHookfishConfig } from '@hookfish/api'
import { durableObjects } from '@hookfish/database/durable-object'
import {
  createGitHubProvider,
  createLinearProvider,
  createMcpProvider,
  createNotionProvider,
} from '@hookfish/providers'

const frontendUrl = process.env.HOOKFISH_FRONTEND_URL ?? 'http://127.0.0.1:5173'

const db = durableObjects<Env>((bindings, context) =>
  bindings.HOOKFISH_DB.getByName(context.organization ?? '__global__'),
)

// To use Postgres instead:
// import { postgres } from '@hookfish/database/postgres'
// const db = postgres(process.env.DATABASE_URL ?? '')

// On Cloudflare Workers, Postgres must be accessed through Hyperdrive:
// import { postgres } from '@hookfish/database/postgres'
// const cloudflareDb = postgres<{ HYPERDRIVE: { connectionString: string } }>(
//   (bindings) => bindings.HYPERDRIVE.connectionString,
//   { cache: false, fetchTypes: false, max: 5, prepare: true },
// )
// const hookfish = await Hookfish.init({ ...config, db: cloudflareDb })
export default defineHookfishConfig<Env>({
  db,
  includeClient: true,
  includeSwagger: true,
  returnTo: frontendUrl,
  trustedOrigins: [frontendUrl], // Allow per-flow return paths on this origin.
  organizationRouting: false, // Use /api/organization/:organization/oauth management routes.
  providerManagement: true,
  // onEvent: async (event) => auditLog.write(event),

  // For a large dynamic registry, replace the provider map below with
  // `createProviderSource` (imported from `@hookfish/api`). OAuth operations
  // call only `getProvider(id)`, while explicit listing requests call the
  // optional `listProviders(query)` callback:
  //
  // providers: createProviderSource({
  //   getProvider: async (id, env) => env.REGISTRY.getProvider(id),
  //   listProviders: async (query, env) => {
  //     const offset = Number(query.get('offset') ?? 0)
  //     const page = await env.REGISTRY.list({ offset, limit: 50 })
  //     return { providers: page.providers, offset, total: page.total }
  //   },
  // }),
  //
  // Hookfish passes custom query and result fields through unchanged, so the
  // registry may instead use cursors or return every provider. See
  // docs/SMITHERY.md for a complete global-registry, org-connections example.
  providers: (env) => ({
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
