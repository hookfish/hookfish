import {
  isProviderRegistry,
  type OAuthProvider,
  type ProviderRegistry,
} from '@hookfish/provider'
import { z } from 'zod'
import { BrokerError } from './errors'
import { encodeResourcePath } from './resource-path'

/**
 * Conventional Hookfish environment fields. Runtime bindings may add
 * provider-specific values and platform services.
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

function bindingValue(
  bindings: object,
  ambient: object,
  key: keyof BrokerConfig,
): unknown {
  return Reflect.has(bindings, key)
    ? Reflect.get(bindings, key)
    : Reflect.get(ambient, key)
}

/**
 * Hookfish owns validation for its broker settings. Request bindings win over
 * the ambient Node environment so Workers can rotate secrets without reloading
 * an isolate.
 */
export function resolveBrokerConfig(bindings: object): BrokerConfig {
  const ambient = ambientEnvironment()

  return brokerConfigSchema.parse({
    NODE_ENV: bindingValue(bindings, ambient, 'NODE_ENV'),
    OAUTH_ENCRYPTION_KEY: bindingValue(
      bindings,
      ambient,
      'OAUTH_ENCRYPTION_KEY',
    ),
    BROKER_API_KEY: bindingValue(bindings, ambient, 'BROKER_API_KEY'),
    OAUTH_REDIRECT_BASE_URL: bindingValue(
      bindings,
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
  providerOrRegistry: OAuthProvider | ProviderRegistry,
): ProviderConfig {
  const provider = isProviderRegistry(providerOrRegistry)
    ? providerOrRegistry.getProvider(providerId)
    : providerOrRegistry

  if (!provider) {
    const knownProviders = isProviderRegistry(providerOrRegistry)
      ? ` Known providers: ${providerOrRegistry.listProviderIds().join(', ')}.`
      : ''
    throw new BrokerError(
      404,
      'unknown_provider',
      `Unknown provider "${providerId}".${knownProviders}`,
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

  return `${base.replace(/\/$/, '')}/api/oauth/callback/${encodeResourcePath(providerId)}`
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
