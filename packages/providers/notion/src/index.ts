import {
  type CreateAuthorizationInput,
  type ExchangeCodeInput,
  type OAuthProvider,
  type OAuthProviderTemplate,
  type ProviderCredentials,
  ProviderRequestError,
  type ProviderTokenResponse,
  type RevokeTokenInput,
  requireProviderCredentials,
  resolveProviderCredentials,
} from '@hookfish/provider'
import { Client } from '@notionhq/client'
import { z } from 'zod'

const tokenSchema = z.looseObject({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  refresh_token: z.string().nullish(),
  workspace_id: z.string().optional(),
  workspace_name: z.string().nullish(),
})

type NotionTokenInput = Parameters<Client['oauth']['token']>[0]
type NotionRevokeInput = Parameters<Client['oauth']['revoke']>[0]

export type NotionOAuthClient = {
  oauth: {
    token(input: NotionTokenInput): Promise<unknown>
    revoke(input: NotionRevokeInput): Promise<unknown>
  }
}

export type NotionProviderOptions = ProviderCredentials & {
  client?: NotionOAuthClient
}

export class NotionProvider implements OAuthProviderTemplate {
  readonly label = 'Notion'
  readonly defaultScopes: readonly string[] = []
  readonly availableScopes: readonly string[] = []
  readonly usesPkce = false

  private readonly credentials: ProviderCredentials
  private readonly client: NotionOAuthClient

  constructor(options: NotionProviderOptions = {}) {
    this.credentials = options
    this.client = options.client ?? new Client()
  }

  createProvider(credentials?: Required<ProviderCredentials>): OAuthProvider {
    return new NotionProvider({
      ...this.credentials,
      client: this.client,
      ...credentials,
    })
  }

  isConfigured() {
    const credentials = resolveProviderCredentials('NOTION', this.credentials)
    return Boolean(credentials.clientId && credentials.clientSecret)
  }

  createAuthorization(input: CreateAuthorizationInput) {
    const credentials = requireProviderCredentials(
      this.label,
      resolveProviderCredentials('NOTION', this.credentials),
    )
    const url = new URL('https://api.notion.com/v1/oauth/authorize')
    url.searchParams.set('client_id', credentials.clientId)
    url.searchParams.set('redirect_uri', input.redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('state', input.state)
    url.searchParams.set('owner', 'user')
    return { url: url.toString() }
  }

  async exchangeCode(input: ExchangeCodeInput): Promise<ProviderTokenResponse> {
    const credentials = requireProviderCredentials(
      this.label,
      resolveProviderCredentials('NOTION', this.credentials),
    )

    try {
      const payload = tokenSchema.parse(
        await this.client.oauth.token({
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          grant_type: 'authorization_code',
          code: input.code,
          redirect_uri: input.redirectUri,
        }),
      )

      return {
        payload,
        account: {
          id: payload.workspace_id,
          label: payload.workspace_name ?? undefined,
        },
      }
    } catch (error) {
      throw new ProviderRequestError('Notion token exchange failed.', {
        cause: error,
      })
    }
  }

  async revokeToken(input: RevokeTokenInput): Promise<void> {
    const credentials = requireProviderCredentials(
      this.label,
      resolveProviderCredentials('NOTION', this.credentials),
    )

    try {
      await this.client.oauth.revoke({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        token: input.accessToken,
      })
    } catch (error) {
      throw new ProviderRequestError('Notion token revocation failed.', {
        cause: error,
      })
    }
  }
}

export function createNotionProvider(
  options: NotionProviderOptions = {},
): NotionProvider {
  return new NotionProvider(options)
}
