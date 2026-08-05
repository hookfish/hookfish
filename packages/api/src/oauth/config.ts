import type { OAuthProvider, ProviderRegistry } from '@hookfish/provider'
import { z } from 'zod'
import { BrokerError } from './errors'

/**
 * Conventional Hookfish configuration fields. The application's config schema
 * may add provider-specific values; runtime service bindings remain separate.
 */
export type BrokerEnv = {
  NODE_ENV?: string
  OAUTH_ENCRYPTION_KEY?: string
  BROKER_API_KEY?: string
  OAUTH_REDIRECT_BASE_URL?: string
  [key: string]: unknown
}

const optionalEnvironmentString = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim().length === 0 ? undefined : value,
  z.string().trim().optional(),
)

const brokerConfigSchema = z.object({
  NODE_ENV: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim().length === 0
        ? undefined
        : value,
    z.string().trim().default('development'),
  ),
  OAUTH_ENCRYPTION_KEY: optionalEnvironmentString,
  BROKER_API_KEY: optionalEnvironmentString,
  OAUTH_REDIRECT_BASE_URL: optionalEnvironmentString,
})

export type BrokerConfig = z.infer<typeof brokerConfigSchema>

function ambientEnvironment(): object {
  const processValue = Reflect.get(globalThis, 'process')
  if (typeof processValue !== 'object' || processValue === null) return {}

  const environment = Reflect.get(processValue, 'env')
  return typeof environment === 'object' && environment !== null
    ? environment
    : {}
}

function configValue(
  config: object,
  ambient: object,
  key: keyof BrokerConfig,
): unknown {
  return Reflect.has(config, key)
    ? Reflect.get(config, key)
    : Reflect.get(ambient, key)
}

/**
 * Hookfish owns its broker settings. Application schemas only need to declare
 * values consumed by application code or provider factories.
 */
export function resolveBrokerConfig(config: object): BrokerConfig {
  const ambient = ambientEnvironment()

  return brokerConfigSchema.parse({
    NODE_ENV: configValue(config, ambient, 'NODE_ENV'),
    OAUTH_ENCRYPTION_KEY: configValue(config, ambient, 'OAUTH_ENCRYPTION_KEY'),
    BROKER_API_KEY: configValue(config, ambient, 'BROKER_API_KEY'),
    OAUTH_REDIRECT_BASE_URL: configValue(
      config,
      ambient,
      'OAUTH_REDIRECT_BASE_URL',
    ),
  })
}

export function readEnvString(env: object, key: string): string | undefined {
  const value = Reflect.get(env, key)

  if (typeof value !== 'string') return undefined

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function requireEnvString(env: object, key: string): string {
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

export function resolveProviderConfig(
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

  return {
    provider,
    scopes: [...(provider.defaultScopes ?? [])],
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
  const nodeEnv = readEnvString(env, 'NODE_ENV') ?? readAmbientNodeEnv()

  if (!configuredBase && nodeEnv === 'production') {
    throw new BrokerError(
      500,
      'missing_configuration',
      'OAUTH_REDIRECT_BASE_URL is required in production so OAuth callbacks never depend on the request Host header.',
    )
  }

  const base = configuredBase ?? new URL(requestUrl).origin

  return `${base.replace(/\/$/, '')}/api/oauth/${providerId}/callback`
}

export function validateReturnTo(
  returnTo: string | undefined,
  trustedOrigins: readonly string[],
): string | undefined {
  if (!returnTo) return undefined

  let destination: URL
  try {
    destination = new URL(returnTo)
  } catch {
    throw new BrokerError(
      400,
      'invalid_return_to',
      '`return_to` must be an absolute URL.',
    )
  }

  if (!['http:', 'https:'].includes(destination.protocol)) {
    throw new BrokerError(
      400,
      'invalid_return_to',
      '`return_to` must use http or https.',
    )
  }

  const allowed = trustedOrigins.some((origin) => {
    try {
      return new URL(origin).origin === destination.origin
    } catch {
      throw new Error(`Invalid trusted origin "${origin}".`)
    }
  })

  if (!allowed) {
    throw new BrokerError(
      400,
      'untrusted_return_to',
      `The return URL origin "${destination.origin}" is not trusted.`,
    )
  }

  return destination.toString()
}

function readAmbientNodeEnv(): string | undefined {
  const value = Reflect.get(ambientEnvironment(), 'NODE_ENV')
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
