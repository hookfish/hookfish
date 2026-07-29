/**
 * Seeds the Notion OAuth provider via the Hono RPC client — same code path as
 * a real API caller.
 *
 * Credentials come from apps/server/.env (`NOTION_CLIENT_ID`, …). Providers
 * without both halves of credentials are skipped.
 *
 *   pnpm db:seed
 *   pnpm --filter @template/api db:seed
 *
 * PGlite is embedded, not a server: a dev server that is already running holds
 * its own instance of `pgdata` in memory and will not observe these writes.
 * Restart it (or seed before starting it) to see the rows.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hc } from 'hono/client'
import app, { type AppType } from '../src/index'
import { createLocalBrokerEnv } from '../src/local-node'
import {
  type BrokerEnv,
  requireBrokerApiKey,
  requireEncryptionKey,
} from '../src/oauth/config'

const apiPackageRoot = path.resolve(fileURLToPath(import.meta.url), '../..')
const serverPackageRoot = path.resolve(apiPackageRoot, '../../apps/server')
const envPath = path.join(serverPackageRoot, '.env')

try {
  process.loadEnvFile(envPath)
  console.log(`Loaded env from ${envPath}`)
} catch {
  console.warn(
    `No .env at ${envPath} — using the ambient environment only.\n` +
      '  Create it with: cp apps/server/.env.example apps/server/.env',
  )
}

type ProviderScope = { value: string; description?: string }

type SeedProvider = {
  id: string
  label: string
  authorize_url: string
  token_url: string
  default_scopes: string[]
  available_scopes: ProviderScope[]
  scope_separator: string
  token_request_format: 'form' | 'json'
  client_auth: 'basic' | 'body'
  use_pkce: boolean
  supports_refresh: boolean
  authorize_params?: Record<string, string>
  account_id_path?: string
  account_label_path?: string
  /** Env prefix, e.g. NOTION → NOTION_CLIENT_ID / _CLIENT_SECRET / _SCOPES */
  envPrefix: string
}

/**
 * Notion's Admin API builds scopes by combining a resource with a capability
 * (`legal-hold:read`), so the catalog below is the cross product of the two
 * documented tables rather than a list Notion publishes verbatim.
 * https://developers.notion.com/reference/admin/scopes
 *
 * Notion warns the resource list "may not be exhaustive", and not every
 * combination is necessarily accepted — treat this as a starting menu.
 */
const NOTION_SCOPE_RESOURCES = [
  { value: 'legal-hold', noun: 'legal hold data and members' },
  { value: 'managed-user-session', noun: "managed users' active sessions" },
  {
    value: 'workspace',
    noun: "your organization's workspaces' data and settings",
  },
]

const NOTION_SCOPE_CAPABILITIES = [
  { value: 'read', verb: 'View' },
  { value: 'write', verb: 'Modify' },
  { value: 'write-high-impact', verb: 'Irreversibly modify' },
  { value: 'export', verb: 'Export' },
]

const NOTION_AVAILABLE_SCOPES: ProviderScope[] = NOTION_SCOPE_RESOURCES.flatMap(
  (resource) =>
    NOTION_SCOPE_CAPABILITIES.map((capability) => ({
      value: `${resource.value}:${capability.value}`,
      description: `${capability.verb} ${resource.noun}`,
    })),
)

const SEED_PROVIDERS: SeedProvider[] = [
  {
    id: 'notion',
    label: 'Notion',
    authorize_url: 'https://api.notion.com/v1/oauth/authorize',
    token_url: 'https://api.notion.com/v1/oauth/token',
    // Notion's integration authorize endpoint takes no `scope` param — access
    // is granted by the pages the user picks in the consent screen. Leaving
    // this empty keeps `scope` off the URL entirely.
    default_scopes: [],
    available_scopes: NOTION_AVAILABLE_SCOPES,
    scope_separator: ' ',
    token_request_format: 'json',
    client_auth: 'basic',
    use_pkce: false,
    // Notion's token response documents `refresh_token` as not-null and
    // supports the `refresh_token` grant, so tokens do expire and refresh.
    supports_refresh: true,
    authorize_params: { owner: 'user' },
    account_id_path: 'workspace_id',
    account_label_path: 'workspace_name',
    envPrefix: 'NOTION',
  },
]

function readEnv(key: string): string | undefined {
  const value = process.env[key]?.trim()
  return value && value.length > 0 ? value : undefined
}

function parseScopes(
  override: string | undefined,
  fallback: string[],
): string[] {
  if (!override) return fallback

  return override
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0)
}

function credentialsFor(prefix: string): {
  client_id: string
  client_secret: string
  scopesOverride?: string
} | null {
  const client_id = readEnv(`${prefix}_CLIENT_ID`)
  const client_secret = readEnv(`${prefix}_CLIENT_SECRET`)

  if (!client_id || !client_secret) return null

  return {
    client_id,
    client_secret,
    scopesOverride: readEnv(`${prefix}_SCOPES`),
  }
}

function createRpcClient(env: BrokerEnv) {
  const apiKey = requireBrokerApiKey(env)

  return hc<AppType>('http://oauth-seed.local/api', {
    headers: { Authorization: `Bearer ${apiKey}` },
    fetch: (input, init) => {
      const request =
        input instanceof Request
          ? new Request(input, init)
          : new Request(String(input), init)

      return app.fetch(request, env)
    },
  })
}

async function seedProvider(
  client: ReturnType<typeof createRpcClient>,
  seed: SeedProvider,
): Promise<'created' | 'updated' | 'skipped'> {
  const credentials = credentialsFor(seed.envPrefix)

  if (!credentials) {
    console.log(
      `  skip  ${seed.id} — set ${seed.envPrefix}_CLIENT_ID and ${seed.envPrefix}_CLIENT_SECRET`,
    )
    return 'skipped'
  }

  const body = {
    id: seed.id,
    label: seed.label,
    authorize_url: seed.authorize_url,
    token_url: seed.token_url,
    client_id: credentials.client_id,
    client_secret: credentials.client_secret,
    default_scopes: parseScopes(
      credentials.scopesOverride,
      seed.default_scopes,
    ),
    available_scopes: seed.available_scopes,
    scope_separator: seed.scope_separator,
    token_request_format: seed.token_request_format,
    client_auth: seed.client_auth,
    use_pkce: seed.use_pkce,
    supports_refresh: seed.supports_refresh,
    authorize_params: seed.authorize_params ?? {},
    account_id_path: seed.account_id_path ?? null,
    account_label_path: seed.account_label_path ?? null,
  }

  const createResponse = await client.oauth.providers.$post({ json: body })

  if (createResponse.status === 201) {
    console.log(`  create ${seed.id}`)
    return 'created'
  }

  if (createResponse.status === 409) {
    const { id: _id, ...patch } = body
    const updateResponse = await client.oauth.providers[':provider'].$patch({
      param: { provider: seed.id },
      json: patch,
    })

    if (!updateResponse.ok) {
      throw new Error(
        `Failed to update ${seed.id}: ${updateResponse.status} ${await updateResponse.text()}`,
      )
    }

    console.log(`  update ${seed.id}`)
    return 'updated'
  }

  throw new Error(
    `Failed to create ${seed.id}: ${createResponse.status} ${await createResponse.text()}`,
  )
}

const dataDir =
  readEnv('PGLITE_DATA_DIR') ?? path.join(serverPackageRoot, 'pgdata')

const env = await createLocalBrokerEnv(dataDir)

// Fail early with a clear message if encryption is missing.
requireEncryptionKey(env)

const client = createRpcClient(env)

console.log(`Seeding providers into PGlite at ${dataDir}`)

let created = 0
let updated = 0
let skipped = 0

for (const seed of SEED_PROVIDERS) {
  const result = await seedProvider(client, seed)
  if (result === 'created') created += 1
  else if (result === 'updated') updated += 1
  else skipped += 1
}

console.log(`Done. created=${created} updated=${updated} skipped=${skipped}`)

if (created + updated === 0) {
  console.warn(
    'No providers seeded. Fill NOTION_CLIENT_ID and NOTION_CLIENT_SECRET in apps/server/.env',
  )
  process.exit(1)
}

console.log(
  'Restart any running dev server to pick these up (embedded PGlite).',
)

// PGlite keeps the event loop alive until the client is closed; exit explicitly.
process.exit(0)
