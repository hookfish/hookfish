import type { HyperdriveBinding } from '../db/resolve'
import type { Database } from '../db/schema'
import { BrokerError } from './errors'
import {
  getProviderDefinition,
  listProviderIds,
  type ProviderDefinition,
} from './providers'

export type { HyperdriveBinding }

/**
 * Bindings available to the Worker / Node host. Provider credentials are read
 * dynamically by name (`NOTION_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, ...) so
 * adding a provider never requires touching this type.
 *
 * Database — configure exactly one (see `resolveDatabaseSource`):
 * - `DB`: injected Drizzle instance (Node + PGlite, or a host-built pool)
 * - `HYPERDRIVE`: Cloudflare Hyperdrive binding (Workers)
 * - `DATABASE_URL`: stock Postgres connection string
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

function envPrefix(providerId: string): string {
  return providerId.toUpperCase().replace(/[^A-Z0-9]/g, '_')
}

/** True when both halves of the provider's credentials are present. */
export function isProviderConfigured(
  env: BrokerEnv,
  providerId: string,
): boolean {
  const prefix = envPrefix(providerId)

  return (
    readEnvString(env, `${prefix}_CLIENT_ID`) !== undefined &&
    readEnvString(env, `${prefix}_CLIENT_SECRET`) !== undefined
  )
}

export function resolveProviderConfig(
  env: BrokerEnv,
  providerId: string,
): ProviderConfig {
  const definition = getProviderDefinition(providerId)

  if (!definition) {
    throw new BrokerError(
      404,
      'unknown_provider',
      `Unknown provider "${providerId}". Known providers: ${listProviderIds().join(', ')}.`,
    )
  }

  const prefix = envPrefix(definition.id)
  const scopeOverride = readEnvString(env, `${prefix}_SCOPES`)

  return {
    definition,
    clientId: requireEnvString(env, `${prefix}_CLIENT_ID`),
    clientSecret: requireEnvString(env, `${prefix}_CLIENT_SECRET`),
    scopes: scopeOverride
      ? scopeOverride
          .split(/[\s,]+/)
          .map((scope) => scope.trim())
          .filter((scope) => scope.length > 0)
      : definition.defaultScopes,
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
