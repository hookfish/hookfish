export class ProviderRequestError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ProviderRequestError'
  }
}

export class ProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderConfigurationError'
  }
}

export type ProviderCredentials = {
  clientId?: string
  clientSecret?: string
}

export type ProviderConfiguration = Record<string, unknown>

export type RegisterProviderClientInput = {
  configuration: ProviderConfiguration
  redirectUri: string
}

export type RegisteredProviderClient = {
  clientId: string
  clientSecret?: string
}

/**
 * A configured provider can also act as the trusted template for database-
 * backed provider instances. Passing no credentials recreates the provider
 * with its fixed defaults; passing credentials replaces the pair atomically.
 */
export interface OAuthProviderTemplate extends OAuthProvider {
  /** Whether a custom client id can be used without a client secret. */
  readonly allowsPublicClient?: boolean

  createProvider(
    credentials?: Required<ProviderCredentials>,
    configuration?: ProviderConfiguration,
  ): OAuthProvider

  /** Validate and canonicalize non-secret, database-backed configuration. */
  normalizeConfiguration?(
    configuration: ProviderConfiguration,
  ): ProviderConfiguration

  /** Register a client when the upstream service supports dynamic registration. */
  registerClient?(
    input: RegisterProviderClientInput,
  ): Promise<RegisteredProviderClient>
}

export type CreateAuthorizationInput = {
  redirectUri: string
  state: string
  scopes: string[]
}

export type AuthorizationRequest = {
  url: string
  /** Present when this authorization must be redeemed with PKCE. */
  codeVerifier?: string
}

export type ExchangeCodeInput = {
  code: string
  redirectUri: string
  codeVerifier?: string
  /** Authorization-server issuer returned with the callback (RFC 9207). */
  issuer?: string
}

export type RefreshTokenInput = {
  refreshToken: string
}

export type RevokeTokenInput = {
  accessToken: string
  /** Present when the provider issued a refresh token for this connection. */
  refreshToken?: string
}

export type ProviderTokenResponse = {
  payload: Record<string, unknown>
  account?: {
    id?: string
    label?: string
  }
}

/**
 * A provider owns its OAuth dialect. The broker only coordinates these
 * lifecycle operations and never needs to know separators, auth styles, or
 * request encodings.
 */
export interface OAuthProvider {
  readonly label?: string
  readonly defaultScopes?: readonly string[]
  readonly availableScopes?: readonly string[]
  readonly usesPkce?: boolean
  isConfigured?(): boolean

  createAuthorization(
    input: CreateAuthorizationInput,
  ): AuthorizationRequest | Promise<AuthorizationRequest>
  exchangeCode(input: ExchangeCodeInput): Promise<ProviderTokenResponse>
  refreshToken?(input: RefreshTokenInput): Promise<ProviderTokenResponse>
  /** Revoke upstream credentials before the broker forgets them locally. */
  revokeToken?(input: RevokeTokenInput): Promise<void>
}

export function isOAuthProviderTemplate(
  provider: OAuthProvider,
): provider is OAuthProviderTemplate {
  return typeof Reflect.get(provider, 'createProvider') === 'function'
}

const registryKey = Symbol.for('@hookfish/provider/registry')

export class ProviderRegistry {
  private readonly providers = new Map<string, OAuthProvider>()

  constructor(providers: Record<string, OAuthProvider> = {}) {
    this.register(providers)
  }

  register(providers: Record<string, OAuthProvider>): void {
    for (const [slug, provider] of Object.entries(providers)) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        throw new Error(
          `Invalid provider slug "${slug}". Use lowercase letters, numbers, and hyphens.`,
        )
      }
      this.providers.set(slug, provider)
    }
  }

  unregister(...slugs: string[]): void {
    for (const slug of slugs) this.providers.delete(slug)
  }

  getProvider(slug: string): OAuthProvider | undefined {
    return this.providers.get(slug)
  }

  listProviderIds(): string[] {
    return [...this.providers.keys()]
  }

  listProviders(): Array<readonly [slug: string, provider: OAuthProvider]> {
    return [...this.providers.entries()]
  }

  isProviderConfigured(slug: string): boolean {
    const provider = this.getProvider(slug)
    return provider !== undefined && (provider.isConfigured?.() ?? true)
  }
}

export function isProviderRegistry(value: unknown): value is ProviderRegistry {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'getProvider') === 'function' &&
    typeof Reflect.get(value, 'listProviders') === 'function'
  )
}

function getDefaultProviderRegistry(): ProviderRegistry {
  const existing = Reflect.get(globalThis, registryKey)
  if (isProviderRegistry(existing)) return existing

  const registry = new ProviderRegistry()
  Reflect.set(globalThis, registryKey, registry)
  return registry
}

// Symbol.for keeps registration shared if a package manager installs more than
// one physical copy of this small contract package in the same process.
export const defaultProviderRegistry = getDefaultProviderRegistry()

export function createProviderRegistry(
  providers: Record<string, OAuthProvider> = {},
): ProviderRegistry {
  return new ProviderRegistry(providers)
}

export function registerProvider(
  providers: Record<string, OAuthProvider>,
): ProviderRegistry {
  defaultProviderRegistry.register(providers)
  return createProviderRegistry(providers)
}

export function unregisterProvider(...slugs: string[]): void {
  defaultProviderRegistry.unregister(...slugs)
}

export function getProvider(slug: string): OAuthProvider | undefined {
  return defaultProviderRegistry.getProvider(slug)
}

export function listProviderIds(): string[] {
  return defaultProviderRegistry.listProviderIds()
}

export function listProviders(): Array<
  readonly [slug: string, provider: OAuthProvider]
> {
  return defaultProviderRegistry.listProviders()
}

export function isProviderConfigured(slug: string): boolean {
  return defaultProviderRegistry.isProviderConfigured(slug)
}

function readAmbientEnv(key: string): string | undefined {
  if (!('process' in globalThis)) return undefined

  const processValue = Reflect.get(globalThis, 'process')
  if (typeof processValue !== 'object' || processValue === null)
    return undefined

  const env = Reflect.get(processValue, 'env')
  if (typeof env !== 'object' || env === null) return undefined

  const value = Reflect.get(env, key)
  if (typeof value !== 'string') return undefined

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function resolveProviderCredentials(
  prefix: string,
  credentials: ProviderCredentials = {},
): ProviderCredentials {
  return {
    clientId: credentials.clientId ?? readAmbientEnv(`${prefix}_CLIENT_ID`),
    clientSecret:
      credentials.clientSecret ?? readAmbientEnv(`${prefix}_CLIENT_SECRET`),
  }
}

export function requireProviderCredentials(
  label: string,
  credentials: ProviderCredentials,
): Required<ProviderCredentials> {
  if (!credentials.clientId || !credentials.clientSecret) {
    throw new ProviderConfigurationError(
      `${label} requires clientId and clientSecret. Pass them to the provider constructor or set the provider's conventional environment variables.`,
    )
  }
  return {
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
  }
}
