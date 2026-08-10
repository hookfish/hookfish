import { describe, expect, it } from 'vitest'
import { defaultOAuthConfigId, oauthRedirectUri } from './oauth-config'

describe('defaultOAuthConfigId', () => {
  it('uses the selected template and increments collisions', () => {
    expect(defaultOAuthConfigId('github', ['github'])).toBe('github-custom')
    expect(
      defaultOAuthConfigId('github', [
        'github',
        'github-custom',
        'github-custom-2',
      ]),
    ).toBe('github-custom-3')
  })
})

describe('oauthRedirectUri', () => {
  it('preserves the advertised callback base while replacing the provider ID', () => {
    expect(
      oauthRedirectUri(
        'https://broker.example.com/api/oauth/github/callback',
        'github-production',
      ),
    ).toBe('https://broker.example.com/api/oauth/github-production/callback')
  })

  it('returns an empty string when a callback template is unavailable', () => {
    expect(oauthRedirectUri(undefined, 'github-production')).toBe('')
  })
})
