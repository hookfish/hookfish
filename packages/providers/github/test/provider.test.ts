import { describe, expect, it, vi } from 'vitest'
import { createGitHubProvider, GitHubProvider } from '../src'

const credentials = { clientId: 'github-client', clientSecret: 'secret' }

describe('GitHubProvider', () => {
  it('describes requested scopes as authorization input', () => {
    expect(new GitHubProvider().inputSchema.fields).toContainEqual(
      expect.objectContaining({
        name: 'scopes',
        type: 'string_list',
        target: 'scopes',
      }),
    )
  })

  it('creates reusable fixed providers with atomic credential overrides', async () => {
    const factory = vi.fn(() => ({
      getWebFlowAuthorizationUrl: () => ({ url: 'https://github.example' }),
      createToken: async () => ({ authentication: { token: 'token' } }),
      deleteToken: async () => undefined,
    }))
    const template = createGitHubProvider({
      ...credentials,
      createOAuthClient: factory,
    })
    const configured = template.createProvider({
      clientId: 'customer-client',
      clientSecret: 'customer-secret',
    })

    await configured.createAuthorization({
      redirectUri: 'https://broker.example/callback',
      state: 'state',
      scopes: [],
    })

    expect(factory).toHaveBeenCalledWith({
      clientId: 'customer-client',
      clientSecret: 'customer-secret',
    })
  })

  it('delegates authorization and token exchange to Octokit', async () => {
    const getWebFlowAuthorizationUrl = vi.fn(() => ({
      url: 'https://github.com/login/oauth/authorize?client_id=github-client',
    }))
    const createToken = vi.fn(async () => ({
      authentication: {
        token: 'github-token',
        scopes: ['repo', 'gist'],
      },
    }))
    const deleteToken = vi.fn(async () => undefined)
    const factory = vi.fn(() => ({
      getWebFlowAuthorizationUrl,
      createToken,
      deleteToken,
    }))
    const provider = new GitHubProvider({
      ...credentials,
      createOAuthClient: factory,
    })

    const authorization = await provider.createAuthorization({
      redirectUri: 'https://broker.example/callback',
      state: 'state',
      scopes: ['repo', 'gist'],
    })
    const token = await provider.exchangeCode({
      code: 'code',
      redirectUri: 'https://broker.example/callback',
    })
    await provider.revokeToken({ accessToken: 'github-token' })

    expect(factory).toHaveBeenCalledWith(credentials)
    expect(getWebFlowAuthorizationUrl).toHaveBeenCalledWith({
      redirectUrl: 'https://broker.example/callback',
      scopes: ['repo', 'gist'],
      state: 'state',
    })
    expect(createToken).toHaveBeenCalledWith({
      code: 'code',
      redirectUrl: 'https://broker.example/callback',
    })
    expect(deleteToken).toHaveBeenCalledWith({ token: 'github-token' })
    expect(authorization.url).toContain('github.com/login/oauth/authorize')
    expect(token.payload).toEqual({
      access_token: 'github-token',
      scope: ['repo', 'gist'],
    })
  })
})
