import {
  type CreateAuthorizationInput,
  type ExchangeCodeInput,
  type OAuthProvider,
  type OAuthProviderTemplate,
  type ProviderCredentials,
  ProviderRequestError,
  type ProviderTokenResponse,
  type RefreshTokenInput,
  type RevokeTokenInput,
  requireProviderCredentials,
  resolveProviderCredentials,
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

export class LinearProvider implements OAuthProviderTemplate {
  readonly authentication = 'oauth' as const
  readonly label = 'Linear'
  readonly inputSchema = {
    fields: [
      {
        name: 'scopes',
        label: 'Scopes',
        type: 'string_list',
        target: 'scopes',
        required: false,
        placeholder: 'read, write',
        description: 'Separate scopes with commas or spaces.',
      },
    ],
  } as const
  readonly defaultScopes = ['read', 'write'] as const
  readonly availableScopes = ['read', 'write'] as const
  readonly usesPkce = false

  private readonly credentials: ProviderCredentials
  private readonly fetcher: ProviderFetch

  constructor(options: LinearProviderOptions = {}) {
    this.credentials = options
    this.fetcher = options.fetch ?? fetch
  }

  createProvider(credentials?: Required<ProviderCredentials>): OAuthProvider {
    return new LinearProvider({
      ...this.credentials,
      fetch: this.fetcher,
      ...credentials,
    })
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

  async revokeToken(input: RevokeTokenInput): Promise<void> {
    const tokens = [
      { token: input.accessToken, token_type_hint: 'access_token' },
      ...(input.refreshToken
        ? [
            {
              token: input.refreshToken,
              token_type_hint: 'refresh_token',
            },
          ]
        : []),
    ]

    try {
      const responses = await Promise.all(
        tokens.map((params) =>
          this.fetcher('https://api.linear.app/oauth/revoke', {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams(params).toString(),
          }),
        ),
      )

      for (const response of responses) {
        if (response.ok) continue

        const text = await response.text()
        throw new ProviderRequestError(
          `Linear revocation endpoint returned ${response.status}: ${text.slice(0, 500)}`,
        )
      }
    } catch (error) {
      if (error instanceof ProviderRequestError) throw error

      throw new ProviderRequestError('Linear token revocation failed.', {
        cause: error,
      })
    }
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

export function createLinearProvider(
  options: LinearProviderOptions = {},
): LinearProvider {
  return new LinearProvider(options)
}
