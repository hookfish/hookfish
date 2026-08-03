import {
  type CreateAuthorizationInput,
  type ExchangeCodeInput,
  type OAuthProvider,
  type ProviderCredentials,
  ProviderRequestError,
  type ProviderTokenResponse,
  requireProviderCredentials,
  resolveProviderCredentials,
  type RefreshTokenInput,
} from '@hookfish/provider'
import { z } from 'zod'

const tokenSchema = z.looseObject({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.coerce.number().int().positive().optional(),
  scope: z.union([z.string(), z.array(z.string())]).optional(),
})

export type ProviderFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export type LinearProviderOptions = ProviderCredentials & {
  fetch?: ProviderFetch
}

export class LinearProvider implements OAuthProvider {
  readonly label = 'Linear'
  readonly defaultScopes = ['read', 'write'] as const
  readonly availableScopes = ['read', 'write'] as const
  readonly usesPkce = false

  private readonly credentials: ProviderCredentials
  private readonly fetcher: ProviderFetch

  constructor(options: LinearProviderOptions = {}) {
    this.credentials = options
    this.fetcher = options.fetch ?? fetch
  }

  isConfigured() {
    const credentials = resolveProviderCredentials('LINEAR', this.credentials)
    return Boolean(credentials.clientId && credentials.clientSecret)
  }

  createAuthorization(input: CreateAuthorizationInput) {
    const url = new URL('https://linear.app/oauth/authorize')
    const credentials = requireProviderCredentials(
      this.label,
      resolveProviderCredentials('LINEAR', this.credentials),
    )
    url.searchParams.set('client_id', credentials.clientId)
    url.searchParams.set('redirect_uri', input.redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('state', input.state)
    if (input.scopes.length > 0) {
      url.searchParams.set('scope', input.scopes.join(','))
    }
    return { url: url.toString() }
  }

  exchangeCode(input: ExchangeCodeInput): Promise<ProviderTokenResponse> {
    return this.requestToken({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      ...(input.codeVerifier ? { code_verifier: input.codeVerifier } : {}),
    })
  }

  refreshToken(input: RefreshTokenInput): Promise<ProviderTokenResponse> {
    return this.requestToken({
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
    })
  }

  private async requestToken(
    params: Record<string, string>,
  ): Promise<ProviderTokenResponse> {
    const credentials = requireProviderCredentials(
      this.label,
      resolveProviderCredentials('LINEAR', this.credentials),
    )
    const response = await this.fetcher('https://api.linear.app/oauth/token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        ...params,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      }).toString(),
    })
    const text = await response.text()

    if (!response.ok) {
      throw new ProviderRequestError(
        `Linear token endpoint returned ${response.status}: ${text.slice(0, 500)}`,
      )
    }

    try {
      return { payload: tokenSchema.parse(JSON.parse(text)) }
    } catch (error) {
      throw new ProviderRequestError(
        `Linear token endpoint returned an invalid JSON body: ${text.slice(0, 200)}`,
        { cause: error },
      )
    }
  }
}
