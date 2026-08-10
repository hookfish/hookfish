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
import { OAuthApp } from '@octokit/oauth-app'
import { z } from 'zod'

const tokenSchema = z.object({
  token: z.string().min(1),
  scopes: z.array(z.string()).optional(),
})

export type GitHubOAuthClient = {
  getWebFlowAuthorizationUrl(input: {
    redirectUrl: string
    scopes: string[]
    state: string
  }): { url: string }
  createToken(input: {
    code: string
    redirectUrl: string
  }): Promise<{ authentication: unknown }>
  deleteToken(input: { token: string }): Promise<unknown>
}

export type GitHubOAuthClientFactory = (
  credentials: Required<ProviderCredentials>,
) => GitHubOAuthClient

const createGitHubOAuthClient: GitHubOAuthClientFactory = (credentials) =>
  new OAuthApp({
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
  })

export type GitHubProviderOptions = ProviderCredentials & {
  createOAuthClient?: GitHubOAuthClientFactory
}

export class GitHubProvider implements OAuthProviderTemplate {
  readonly label = 'GitHub'
  readonly defaultScopes: readonly string[] = []
  readonly availableScopes = [
    'repo',
    'repo:status',
    'repo_deployment',
    'public_repo',
    'repo:invite',
    'security_events',
    'admin:repo_hook',
    'write:repo_hook',
    'read:repo_hook',
    'admin:org',
    'write:org',
    'read:org',
    'admin:public_key',
    'write:public_key',
    'read:public_key',
    'admin:org_hook',
    'gist',
    'notifications',
    'user',
    'read:user',
    'user:email',
    'user:follow',
    'project',
    'read:project',
    'delete_repo',
    'write:packages',
    'read:packages',
    'delete:packages',
    'admin:gpg_key',
    'write:gpg_key',
    'read:gpg_key',
    'codespace',
    'workflow',
    'read:audit_log',
  ] as const
  readonly usesPkce = false

  private readonly credentials: ProviderCredentials
  private readonly createOAuthClient: GitHubOAuthClientFactory

  constructor(options: GitHubProviderOptions = {}) {
    this.credentials = options
    this.createOAuthClient =
      options.createOAuthClient ?? createGitHubOAuthClient
  }

  createProvider(credentials?: Required<ProviderCredentials>): OAuthProvider {
    return new GitHubProvider({
      ...this.credentials,
      createOAuthClient: this.createOAuthClient,
      ...credentials,
    })
  }

  isConfigured() {
    const credentials = resolveProviderCredentials('GITHUB', this.credentials)
    return Boolean(credentials.clientId && credentials.clientSecret)
  }

  createAuthorization(input: CreateAuthorizationInput) {
    const credentials = requireProviderCredentials(
      this.label,
      resolveProviderCredentials('GITHUB', this.credentials),
    )
    const oauth = this.createOAuthClient(credentials)
    const { url } = oauth.getWebFlowAuthorizationUrl({
      redirectUrl: input.redirectUri,
      scopes: input.scopes,
      state: input.state,
    })
    return { url }
  }

  async exchangeCode(input: ExchangeCodeInput): Promise<ProviderTokenResponse> {
    const credentials = requireProviderCredentials(
      this.label,
      resolveProviderCredentials('GITHUB', this.credentials),
    )

    try {
      const { authentication } = await this.createOAuthClient(
        credentials,
      ).createToken({
        code: input.code,
        redirectUrl: input.redirectUri,
      })
      const response = tokenSchema.parse(authentication)

      return {
        payload: {
          access_token: response.token,
          scope: response.scopes,
        },
      }
    } catch (error) {
      throw new ProviderRequestError('GitHub token exchange failed.', {
        cause: error,
      })
    }
  }

  async revokeToken(input: RevokeTokenInput): Promise<void> {
    const credentials = requireProviderCredentials(
      this.label,
      resolveProviderCredentials('GITHUB', this.credentials),
    )

    try {
      await this.createOAuthClient(credentials).deleteToken({
        token: input.accessToken,
      })
    } catch (error) {
      throw new ProviderRequestError('GitHub token revocation failed.', {
        cause: error,
      })
    }
  }
}

export function createGitHubProvider(
  options: GitHubProviderOptions = {},
): GitHubProvider {
  return new GitHubProvider(options)
}
