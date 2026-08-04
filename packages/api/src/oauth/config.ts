import type { OAuthProvider, ProviderRegistry } from '@hookfish/provider'
import { BrokerError } from './errors'

/**
 * Conventional Hookfish configuration bindings. Hosts may pass any additional
 * runtime-owned bindings through `Hookfish.fetch`.
 */
export type BrokerEnv = {
  OAUTH_ENCRYPTION_KEY?: string
  CREDENTIALS_ENCRYPTION_KEY?: string
  CREDENTIALS_OWNER_ID?: string
  BROKER_API_KEY?: string
  OAUTH_REDIRECT_BASE_URL?: string
  [key: string]: unknown
}

export function readEnvString(env: object, key: string): string | undefined {
  const value = Reflect.get(env, key)

  if (typeof value !== 'string') return undefined

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function requireEnvString(env: object, key: string): string {
  const value = readEnvString(env, key)

  if (!value) {
    throw new BrokerError(
      500,
      'missing_configuration',
      `${key} is not set. Add it to the Node environment or .env file.`,
    )
  }

  return value
}

export type ProviderConfig = {
  provider: OAuthProvider
  scopes: string[]
}

function envPrefix(providerId: string): string {
  return providerId.toUpperCase().replace(/[^A-Z0-9]/g, '_')
}

export function resolveProviderConfig(
  env: object,
  providerId: string,
  providers: ProviderRegistry,
): ProviderConfig {
  const provider = providers.getProvider(providerId)

  if (!provider) {
    throw new BrokerError(
      404,
      'unknown_provider',
      `Unknown provider "${providerId}". Known providers: ${providers.listProviderIds().join(', ')}.`,
    )
  }

  const prefix = envPrefix(providerId)
  const scopeOverride = readEnvString(env, `${prefix}_SCOPES`)

  return {
    provider,
    scopes: scopeOverride
      ? scopeOverride
          .split(/[\s,]+/)
          .map((scope) => scope.trim())
          .filter((scope) => scope.length > 0)
      : [...(provider.defaultScopes ?? [])],
  }
}

/**
 * The callback URL registered with the provider. Falls back to the origin of
 * the incoming request, which keeps local dev working without extra config.
 */
export function resolveRedirectUri(
  env: object,
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

export function requireBrokerApiKey(env: object): string {
  const configured = readEnvString(env, 'BROKER_API_KEY')
  if (configured) return configured

  const nodeEnv = readEnvString(env, 'NODE_ENV') ?? readAmbientNodeEnv()

  if (nodeEnv !== 'production') {
    return 'test'
  }

  return requireEnvString(env, 'BROKER_API_KEY')
}
