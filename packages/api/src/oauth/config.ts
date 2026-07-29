import type { Database } from '../db/types'
import { BrokerError } from './errors'
import {
  findProviderRow,
  resolveProviderCredentials,
  rowToDefinition,
  type ProviderDefinition,
} from './providers'

/**
 * Bindings available to the Worker / Node entrypoint.
 *
 * Provider credentials live encrypted in `oauth_providers` — they are no longer
 * read from `<ID>_CLIENT_ID` / `<ID>_CLIENT_SECRET` env vars.
 *
 * `DB` is only ever populated by the Node entrypoint, which injects a live
 * PGlite-backed Drizzle instance; the Worker builds one from DATABASE_URL.
 */
export type BrokerEnv = {
  DATABASE_URL?: string
  OAUTH_ENCRYPTION_KEY?: string
  BROKER_API_KEY?: string
  OAUTH_REDIRECT_BASE_URL?: string
  PGLITE_DATA_DIR?: string
  DB?: Database
  [key: string]: string | Database | undefined
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

export function requireEncryptionKey(env: BrokerEnv): string {
  return requireEnvString(env, 'OAUTH_ENCRYPTION_KEY')
}

export type ProviderConfig = {
  definition: ProviderDefinition
  clientId: string
  clientSecret: string
  scopes: string[]
}

export async function resolveProviderConfig(
  db: Database,
  env: BrokerEnv,
  providerId: string,
): Promise<ProviderConfig> {
  const row = await findProviderRow(db, providerId)

  if (!row) {
    throw new BrokerError(
      404,
      'unknown_provider',
      `Unknown provider "${providerId}". Register one with POST /api/oauth/providers.`,
    )
  }

  const definition = rowToDefinition(row)
  const credentials = await resolveProviderCredentials(
    requireEncryptionKey(env),
    row,
  )

  return {
    definition,
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
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

  return `${base.replace(/\/$/, '')}/api/oauth/${providerId}/callback`
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
