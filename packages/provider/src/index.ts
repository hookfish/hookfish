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

export type ProviderAuthentication = 'oauth' | 'secret'

export type ProviderInputField = {
  readonly name: string
  readonly label: string
  readonly type: 'text' | 'url' | 'string_list'
  readonly target: 'identity' | 'configuration' | 'scopes'
  readonly required: boolean
  readonly placeholder?: string
  readonly description?: string
}

export type ProviderInputSchema = {
  readonly fields: readonly ProviderInputField[]
}

/** A provider whose credential is supplied directly by trusted application code. */
export interface SecretProvider {
  readonly kind: 'secret'
  readonly authentication?: 'secret'
  readonly label?: string
  readonly inputSchema?: ProviderInputSchema
}

export function createSecretProvider(label = 'Secret'): SecretProvider {
  return {
    kind: 'secret',
    authentication: 'secret',
    label,
    inputSchema: {
      fields: [
        {
          name: 'name',
          label: 'Credential name',
          type: 'text',
          target: 'identity',
          required: true,
          placeholder: 'openai',
        },
      ],
    },
  }
}

export type RegisterProviderClientInput = {
  configuration: ProviderConfiguration
  redirectUri: string
  clientMetadataUrl: string
}

export type RegisteredProviderClient = {
  clientId: string
  clientSecret?: string
  issuer?: string
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
  readonly authentication?: 'oauth'
  /** @deprecated Authentication and inputSchema describe provider behavior. */
  readonly kind?: 'oauth' | 'mcp'
  readonly label?: string
  readonly inputSchema?: ProviderInputSchema
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

/** Trusted code selected by the final segment of a connection path. */
export type ConnectionProvider = OAuthProvider | SecretProvider

export function isSecretProvider(
  provider: ConnectionProvider,
): provider is SecretProvider {
  return provider.kind === 'secret'
}

export type ProviderSourceEntry = {
  id: string
  provider: ConnectionProvider
}

/**
 * A provider listing always contains provider entries, while registry-specific
 * pagination or result metadata may be returned alongside them.
 */
export type ProviderSourceListResult = {
  providers: ProviderSourceEntry[]
  [key: string]: unknown
}

export type ProviderSourceResult<T> = T | Promise<T>

/** The read-only URL query surface passed to provider listings. */
export interface ProviderSourceQuery {
  get(name: string): string | null
  getAll(name: string): string[]
  has(name: string): boolean
  toString(): string
}

/**
 * Lazily resolves providers from an application-owned registry.
 *
 * `getProvider` is the OAuth hot path and should fetch only the requested
 * provider. `listProviders` is optional and receives the request query string
 * unchanged, allowing registries to list everything or implement their own
 * offset, cursor, search, and filtering conventions.
 */
export interface ProviderSource<Bindings extends object = object> {
  getProvider(
    providerId: string,
    bindings: Bindings,
  ): ProviderSourceResult<ConnectionProvider | undefined>
  listProviders?(
    query: ProviderSourceQuery,
    bindings: Bindings,
  ): ProviderSourceResult<ProviderSourceListResult>
}

/** Define a lazy provider source while preserving its binding types. */
export function createProviderSource<Bindings extends object = object>(
  source: ProviderSource<Bindings>,
): ProviderSource<Bindings> {
  return source
}

export function isProviderSource(
  value: unknown,
): value is ProviderSource<object> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'getProvider') === 'function' &&
    !isProviderRegistry(value)
  )
}

export function isOAuthProviderTemplate(
  provider: OAuthProvider,
): provider is OAuthProviderTemplate {
  return typeof Reflect.get(provider, 'createProvider') === 'function'
}

const registryKey = Symbol.for('@hookfish/provider/registry')

const javascriptReservedProviderIds = new Set([
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
])

/** Whether a provider ID is a slash-free, non-reserved JavaScript identifier. */
export function isValidProviderId(providerId: string): boolean {
  return (
    providerId.length <= 128 &&
    /^[a-z][A-Za-z0-9]*$/.test(providerId) &&
    !javascriptReservedProviderIds.has(providerId)
  )
}

export class ProviderRegistry {
  private readonly providers = new Map<string, ConnectionProvider>()

  constructor(providers: Record<string, ConnectionProvider> = {}) {
    this.register(providers)
  }

  register(providers: Record<string, ConnectionProvider>): void {
    for (const [slug, provider] of Object.entries(providers)) {
      if (!isValidProviderId(slug)) {
        throw new Error(
          `Invalid provider id "${slug}". Use a non-reserved lower-camel JavaScript identifier up to 128 characters.`,
        )
      }
      this.providers.set(slug, provider)
    }
  }

  unregister(...slugs: string[]): void {
    for (const slug of slugs) this.providers.delete(slug)
  }

  getProvider(slug: string): ConnectionProvider | undefined {
    return this.providers.get(slug)
  }

  listProviderIds(): string[] {
    return [...this.providers.keys()]
  }

  listProviders(): Array<
    readonly [slug: string, provider: ConnectionProvider]
  > {
    return [...this.providers.entries()]
  }

  isProviderConfigured(slug: string): boolean {
    const provider = this.getProvider(slug)
    return (
      provider !== undefined &&
      (isSecretProvider(provider) ||
        (provider.inputSchema?.fields ?? []).some(
          (field) => field.target === 'identity',
        ) ||
        (provider.isConfigured?.() ?? true))
    )
  }
}

export function isProviderRegistry(value: unknown): value is ProviderRegistry {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'getProvider') === 'function' &&
    typeof Reflect.get(value, 'listProviders') === 'function' &&
    typeof Reflect.get(value, 'listProviderIds') === 'function' &&
    typeof Reflect.get(value, 'isProviderConfigured') === 'function'
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
  providers: Record<string, ConnectionProvider> = {},
): ProviderRegistry {
  return new ProviderRegistry(providers)
}

export function registerProvider(
  providers: Record<string, ConnectionProvider>,
): ProviderRegistry {
  defaultProviderRegistry.register(providers)
  return createProviderRegistry(providers)
}

export function unregisterProvider(...slugs: string[]): void {
  defaultProviderRegistry.unregister(...slugs)
}

export function getProvider(slug: string): ConnectionProvider | undefined {
  return defaultProviderRegistry.getProvider(slug)
}

export function listProviderIds(): string[] {
  return defaultProviderRegistry.listProviderIds()
}

export function listProviders(): Array<
  readonly [slug: string, provider: ConnectionProvider]
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
