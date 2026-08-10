import {
  type CreateAuthorizationInput,
  type ExchangeCodeInput,
  type OAuthProvider,
  type OAuthProviderTemplate,
  type ProviderConfiguration,
  type ProviderCredentials,
  ProviderConfigurationError,
  ProviderRequestError,
  type ProviderTokenResponse,
  type RefreshTokenInput,
  type RegisteredProviderClient,
  type RegisterProviderClientInput,
} from '@hookfish/provider'
import { z } from 'zod'

const httpUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol
  return protocol === 'https:' || protocol === 'http:'
}, 'URL must use http or https')

const mcpConfigurationSchema = z.object({
  resource_url: httpUrlSchema,
  scopes: z.array(z.string().trim().min(1).max(512)).max(128).default([]),
})

const protectedResourceMetadataSchema = z.looseObject({
  resource: httpUrlSchema.optional(),
  authorization_servers: z.array(httpUrlSchema).min(1),
  scopes_supported: z.array(z.string()).optional(),
})

const authorizationServerMetadataSchema = z.looseObject({
  issuer: httpUrlSchema,
  authorization_endpoint: httpUrlSchema,
  token_endpoint: httpUrlSchema,
  registration_endpoint: httpUrlSchema.optional(),
  client_id_metadata_document_supported: z.boolean().optional(),
  scopes_supported: z.array(z.string()).optional(),
  code_challenge_methods_supported: z.array(z.string()).optional(),
  token_endpoint_auth_methods_supported: z.array(z.string()).optional(),
})

const registrationResponseSchema = z.looseObject({
  client_id: z.string().min(1),
  client_secret: z.string().min(1).optional(),
})

const tokenResponseSchema = z.looseObject({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.coerce.number().int().positive().optional(),
  scope: z.union([z.string(), z.array(z.string())]).optional(),
})

export type McpProviderConfiguration = z.infer<typeof mcpConfigurationSchema>

export type ProviderFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export type McpProviderOptions = ProviderCredentials & {
  resourceUrl?: string
  scopes?: readonly string[]
  fetch?: ProviderFetch
}

type Discovery = {
  resourceUrl: string
  resourceScopes: string[]
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint?: string
  clientIdMetadataDocumentSupported: boolean
  tokenEndpointAuthMethods: string[]
}

function normalizeHttpUrl(value: string, name: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ProviderConfigurationError(`${name} must be an absolute URL.`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ProviderConfigurationError(`${name} must use http or https.`)
  }
  url.hash = ''
  return url.toString()
}

function pathAwareWellKnown(resourceUrl: string): string {
  const resource = new URL(resourceUrl)
  const metadata = new URL('/.well-known/oauth-protected-resource', resource)
  if (resource.pathname !== '/') {
    metadata.pathname = `${metadata.pathname}${resource.pathname}`
  }
  return metadata.toString()
}

function rootWellKnown(resourceUrl: string): string {
  return new URL(
    '/.well-known/oauth-protected-resource',
    resourceUrl,
  ).toString()
}

function authorizationMetadataUrls(issuerValue: string): string[] {
  const issuer = new URL(issuerValue)
  const suffix = issuer.pathname === '/' ? '' : issuer.pathname
  const origin = issuer.origin
  const urls = [
    `${origin}/.well-known/oauth-authorization-server${suffix}`,
    `${origin}/.well-known/openid-configuration${suffix}`,
  ]
  if (suffix) {
    urls.push(`${origin}${suffix}/.well-known/openid-configuration`)
  }
  return urls
}

function challengeParameter(header: string | null, name: string) {
  if (!header) return undefined
  const match = header.match(new RegExp(`(?:^|[,\\s])${name}="([^"]+)"`, 'i'))
  return match?.[1]
}

async function responseJson(
  fetcher: ProviderFetch,
  url: string,
): Promise<unknown | undefined> {
  let response: Response
  try {
    response = await fetcher(url, {
      headers: { Accept: 'application/json' },
      redirect: 'follow',
    })
  } catch {
    return undefined
  }
  if (!response.ok) return undefined
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

async function discover(
  fetcher: ProviderFetch,
  resourceUrl: string,
): Promise<Discovery> {
  let challengeUrl: string | undefined
  let challengeScopes: string[] = []
  try {
    const response = await fetcher(resourceUrl, {
      headers: {
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2026-07-28',
      },
      redirect: 'manual',
    })
    const challenge = response.headers.get('WWW-Authenticate')
    const advertisedMetadataUrl = challengeParameter(
      challenge,
      'resource_metadata',
    )
    if (advertisedMetadataUrl) {
      try {
        challengeUrl = normalizeHttpUrl(
          advertisedMetadataUrl,
          'MCP protected-resource metadata URL',
        )
      } catch {
        challengeUrl = undefined
      }
    }
    challengeScopes =
      challengeParameter(challenge, 'scope')?.split(/\s+/).filter(Boolean) ?? []
  } catch {
    // Well-known discovery below remains authoritative when probing the
    // resource itself is unavailable or does not return an OAuth challenge.
  }

  const metadataUrls = [
    challengeUrl,
    pathAwareWellKnown(resourceUrl),
    rootWellKnown(resourceUrl),
  ].filter((value, index, values): value is string =>
    Boolean(value && values.indexOf(value) === index),
  )

  let resourceMetadata:
    | z.infer<typeof protectedResourceMetadataSchema>
    | undefined
  for (const metadataUrl of metadataUrls) {
    const payload = await responseJson(fetcher, metadataUrl)
    const parsed = protectedResourceMetadataSchema.safeParse(payload)
    if (parsed.success) {
      resourceMetadata = parsed.data
      break
    }
  }
  if (!resourceMetadata) {
    throw new ProviderRequestError(
      `Could not discover OAuth protected-resource metadata for ${resourceUrl}.`,
    )
  }

  const issuer = resourceMetadata.authorization_servers[0]
  let serverMetadata:
    | z.infer<typeof authorizationServerMetadataSchema>
    | undefined
  for (const metadataUrl of authorizationMetadataUrls(issuer)) {
    const payload = await responseJson(fetcher, metadataUrl)
    const parsed = authorizationServerMetadataSchema.safeParse(payload)
    if (parsed.success && parsed.data.issuer === issuer) {
      serverMetadata = parsed.data
      break
    }
  }
  if (!serverMetadata) {
    throw new ProviderRequestError(
      `Could not discover OAuth authorization-server metadata for ${issuer}.`,
    )
  }
  if (!serverMetadata.code_challenge_methods_supported?.includes('S256')) {
    throw new ProviderRequestError(
      `The MCP authorization server ${issuer} does not advertise PKCE S256 support.`,
    )
  }

  return {
    resourceUrl: resourceMetadata.resource ?? resourceUrl,
    resourceScopes:
      challengeScopes.length > 0
        ? challengeScopes
        : (resourceMetadata.scopes_supported ??
          serverMetadata.scopes_supported ??
          []),
    issuer: serverMetadata.issuer,
    authorizationEndpoint: serverMetadata.authorization_endpoint,
    tokenEndpoint: serverMetadata.token_endpoint,
    registrationEndpoint: serverMetadata.registration_endpoint,
    clientIdMetadataDocumentSupported:
      serverMetadata.client_id_metadata_document_supported ?? false,
    tokenEndpointAuthMethods:
      serverMetadata.token_endpoint_auth_methods_supported ?? [],
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function createPkcePair() {
  const random = crypto.getRandomValues(new Uint8Array(32))
  const verifier = toBase64Url(random)
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  )
  return { verifier, challenge: toBase64Url(new Uint8Array(digest)) }
}

export class McpProvider implements OAuthProviderTemplate {
  readonly kind = 'mcp' as const
  readonly label = 'MCP server'
  readonly usesPkce = true
  readonly allowsPublicClient = true
  readonly defaultScopes: readonly string[]
  readonly availableScopes: readonly string[]

  private readonly credentials: ProviderCredentials
  private readonly resourceUrl: string | undefined
  private readonly fetcher: ProviderFetch

  constructor(options: McpProviderOptions = {}) {
    this.credentials = options
    this.resourceUrl = options.resourceUrl
      ? normalizeHttpUrl(options.resourceUrl, 'MCP server URL')
      : undefined
    this.defaultScopes = [...(options.scopes ?? [])]
    this.availableScopes = this.defaultScopes
    this.fetcher = options.fetch ?? fetch
  }

  createProvider(
    credentials?: Required<ProviderCredentials>,
    configuration: ProviderConfiguration = {},
  ): OAuthProvider {
    const normalized = mcpConfigurationSchema.parse(configuration)
    return new McpProvider({
      ...this.credentials,
      ...credentials,
      resourceUrl: normalized.resource_url,
      scopes: normalized.scopes,
      fetch: this.fetcher,
    })
  }

  normalizeConfiguration(
    configuration: ProviderConfiguration,
  ): ProviderConfiguration {
    const parsed = mcpConfigurationSchema.safeParse(configuration)
    if (!parsed.success) {
      throw new ProviderConfigurationError(
        'MCP configuration requires an absolute resource_url and an optional list of scopes.',
      )
    }
    return parsed.data
  }

  async registerClient(
    input: RegisterProviderClientInput,
  ): Promise<RegisteredProviderClient> {
    const configuration = mcpConfigurationSchema.parse(input.configuration)
    const discovery = await discover(this.fetcher, configuration.resource_url)
    const metadataUrl = new URL(input.redirectUri)
    if (
      discovery.clientIdMetadataDocumentSupported &&
      metadataUrl.protocol === 'https:'
    ) {
      metadataUrl.pathname = metadataUrl.pathname.replace(
        '/oauth/callback/',
        '/oauth/client-metadata/',
      )
      return { clientId: metadataUrl.toString() }
    }
    if (!discovery.registrationEndpoint) {
      throw new ProviderConfigurationError(
        'This MCP authorization server does not support dynamic client registration. Enter a pre-registered client ID instead.',
      )
    }

    const redirect = new URL(input.redirectUri)
    const applicationType =
      redirect.hostname === 'localhost' || redirect.hostname === '127.0.0.1'
        ? 'native'
        : 'web'
    const response = await this.fetcher(discovery.registrationEndpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_name: 'Hookfish MCP OAuth broker',
        redirect_uris: [input.redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        application_type: applicationType,
      }),
    })
    const text = await response.text()
    if (!response.ok) {
      throw new ProviderRequestError(
        `MCP client registration returned ${response.status}: ${text.slice(0, 500)}`,
      )
    }
    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch {
      throw new ProviderRequestError(
        'MCP client registration returned an invalid JSON response.',
      )
    }
    const parsed = registrationResponseSchema.safeParse(payload)
    if (!parsed.success) {
      throw new ProviderRequestError(
        'MCP client registration returned an invalid response.',
      )
    }
    return {
      clientId: parsed.data.client_id,
      clientSecret: parsed.data.client_secret,
    }
  }

  isConfigured() {
    return Boolean(this.resourceUrl && this.credentials.clientId)
  }

  async createAuthorization(input: CreateAuthorizationInput) {
    const { resourceUrl, clientId } = this.requireConfiguration()
    const discovery = await discover(this.fetcher, resourceUrl)
    const pkce = await createPkcePair()
    const url = new URL(discovery.authorizationEndpoint)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', input.redirectUri)
    url.searchParams.set('state', input.state)
    url.searchParams.set('code_challenge', pkce.challenge)
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.set('resource', discovery.resourceUrl)
    const scopes =
      input.scopes.length > 0 ? input.scopes : discovery.resourceScopes
    if (scopes.length > 0) url.searchParams.set('scope', scopes.join(' '))
    return { url: url.toString(), codeVerifier: pkce.verifier }
  }

  async exchangeCode(input: ExchangeCodeInput): Promise<ProviderTokenResponse> {
    const { resourceUrl } = this.requireConfiguration()
    const discovery = await discover(this.fetcher, resourceUrl)
    if (input.issuer && input.issuer !== discovery.issuer) {
      throw new ProviderRequestError(
        'The authorization callback issuer does not match the MCP authorization server.',
      )
    }
    return this.requestToken(discovery, {
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      ...(input.codeVerifier ? { code_verifier: input.codeVerifier } : {}),
    })
  }

  async refreshToken(input: RefreshTokenInput): Promise<ProviderTokenResponse> {
    const { resourceUrl } = this.requireConfiguration()
    const discovery = await discover(this.fetcher, resourceUrl)
    return this.requestToken(discovery, {
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
    })
  }

  private requireConfiguration() {
    if (!this.resourceUrl || !this.credentials.clientId) {
      throw new ProviderConfigurationError(
        'MCP requires a server URL and registered OAuth client ID.',
      )
    }
    return {
      resourceUrl: this.resourceUrl,
      clientId: this.credentials.clientId,
    }
  }

  private async requestToken(
    discovery: Discovery,
    params: Record<string, string>,
  ): Promise<ProviderTokenResponse> {
    const { clientId } = this.requireConfiguration()
    const body = new URLSearchParams({
      ...params,
      client_id: clientId,
      resource: discovery.resourceUrl,
    })
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    }
    if (this.credentials.clientSecret) {
      if (discovery.tokenEndpointAuthMethods.includes('client_secret_basic')) {
        headers.Authorization = `Basic ${btoa(`${clientId}:${this.credentials.clientSecret}`)}`
      } else {
        body.set('client_secret', this.credentials.clientSecret)
      }
    }

    const response = await this.fetcher(discovery.tokenEndpoint, {
      method: 'POST',
      headers,
      body: body.toString(),
    })
    const text = await response.text()
    if (!response.ok) {
      throw new ProviderRequestError(
        `MCP token endpoint returned ${response.status}: ${text.slice(0, 500)}`,
      )
    }
    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch {
      throw new ProviderRequestError(
        `MCP token endpoint returned an invalid JSON response: ${text.slice(0, 200)}`,
      )
    }
    const parsed = tokenResponseSchema.safeParse(payload)
    if (!parsed.success) {
      throw new ProviderRequestError(
        `MCP token endpoint returned an invalid response: ${text.slice(0, 200)}`,
      )
    }
    return { payload: parsed.data }
  }
}

export function createMcpProvider(
  options: McpProviderOptions = {},
): McpProvider {
  return new McpProvider(options)
}
