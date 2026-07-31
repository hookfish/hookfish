import type { HyperdriveBinding } from '../db/resolve'
import type { Database } from '../db/schema'
import { decryptSecret } from './crypto'
import { BrokerError } from './errors'
import {
  isProviderRowConfigured,
  requireProviderRow,
  rowToDefinition,
  type ProviderDefinition,
} from './providers'

export type { HyperdriveBinding }

/**
 * Bindings available to the Worker / Node host.
 *
 * Database — configure exactly one (see `resolveDatabaseSource`):
 * - `DB`: injected Drizzle instance (Node + PGlite, or a host-built pool)
 * - `HYPERDRIVE`: Cloudflare Hyperdrive binding (Workers)
 * - `DATABASE_URL`: stock Postgres connection string
 *
 * Provider credentials live encrypted on `oauth_providers` rows. Optional
 * `<ID>_CLIENT_ID` / `_SECRET` env vars are only used by the Node bootstrap
 * helper to seed empty rows during cutover.
 */
export type BrokerEnv = {
  DATABASE_URL?: string
  HYPERDRIVE?: HyperdriveBinding
  OAUTH_ENCRYPTION_KEY?: string
  BROKER_API_KEY?: string
  OAUTH_REDIRECT_BASE_URL?: string
  PGLITE_DATA_DIR?: string
  DB?: Database
  [key: string]: string | Database | HyperdriveBinding | undefined
}

export function readEnvString(env: BrokerEnv, key: string): string | undefined {
  const value = env[key]

  if (typeof value !== 'string') return undefined

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function requireEnvString(env: BrokerEnv, key: string): string {
  const value = readEnvString(env, key)

  if (!value) {
    throw new BrokerError(
      500,
      'missing_configuration',
      `${key} is not set. Add it to .env (local) or as a Worker secret.`,
    )
  }

  return value
}

export type ProviderConfig = {
  definition: ProviderDefinition
  clientId: string
  clientSecret: string
  scopes: string[]
}

export function isProviderConfigured(
  row: Parameters<typeof isProviderRowConfigured>[0],
): boolean {
  return isProviderRowConfigured(row)
}

export async function resolveProviderConfig(
  db: Database,
  env: BrokerEnv,
  providerId: string,
): Promise<ProviderConfig> {
  const row = await requireProviderRow(db, providerId, { requireEnabled: true })
  const definition = rowToDefinition(row)

  if (!isProviderRowConfigured(row)) {
    throw new BrokerError(
      500,
      'missing_configuration',
      `Provider "${providerId}" has no credentials. PATCH /api/oauth/providers/${providerId} with client_id and client_secret.`,
    )
  }

  const encryptionKey = requireEnvString(env, 'OAUTH_ENCRYPTION_KEY')

  return {
    definition,
    clientId: await decryptSecret(encryptionKey, row.clientIdEncrypted!),
    clientSecret: await decryptSecret(
      encryptionKey,
      row.clientSecretEncrypted!,
    ),
    scopes: definition.defaultScopes,
  }
}

/**
 * The callback URL registered with the provider. Falls back to the origin of
 * the incoming request, which keeps local dev working without extra config.
 */
export function resolveRedirectUri(
  env: BrokerEnv,
  requestUrl: string,
  providerId: string,
): string {
  const configuredBase = readEnvString(env, 'OAUTH_REDIRECT_BASE_URL')
  const base = configuredBase ?? new URL(requestUrl).origin

  return `${base.replace(/\/$/, '')}/api/oauth/provider/${providerId}/callback`
}

function readAmbientNodeEnv(): string | undefined {
  if (!('process' in globalThis)) return undefined

  const proc = Reflect.get(globalThis, 'process')
  if (typeof proc !== 'object' || proc === null || !('env' in proc)) {
    return undefined
  }

  const value = Reflect.get(proc.env, 'NODE_ENV')
  return typeof value === 'string' ? value : undefined
}

export function requireBrokerApiKey(env: BrokerEnv): string {
  const configured = readEnvString(env, 'BROKER_API_KEY')
  if (configured) return configured

  const nodeEnv = readEnvString(env, 'NODE_ENV') ?? readAmbientNodeEnv()

  if (nodeEnv !== 'production') {
    return 'test'
  }

  return requireEnvString(env, 'BROKER_API_KEY')
}
