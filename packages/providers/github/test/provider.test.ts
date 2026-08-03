import { describe, expect, it, vi } from 'vitest'
import { GitHubProvider } from '../src'

const credentials = { clientId: 'github-client', clientSecret: 'secret' }

describe('GitHubProvider', () => {
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
    const factory = vi.fn(() => ({
      getWebFlowAuthorizationUrl,
      createToken,
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
    expect(authorization.url).toContain('github.com/login/oauth/authorize')
    expect(token.payload).toEqual({
      access_token: 'github-token',
      scope: ['repo', 'gist'],
    })
  })
})
