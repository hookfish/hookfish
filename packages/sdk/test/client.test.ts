import { describe, expect, it } from 'vitest'
import { Hookfish, HookfishError } from '../src'

const token = {
  connection_id: 'personal/gmail',
  provider: 'gmail',
  access_token: 'gmail-token',
  token_type: 'Bearer',
  scopes: [],
  expires_at: null,
  refreshed: false,
}

describe('Hookfish', () => {
  it('uses the global API and encodes slash-delimited resource ids', async () => {
    let request: Request | undefined
    const hookfish = new Hookfish({
      apiKey: 'broker-key',
      baseUrl: 'http://local/api',
      fetch: async (input, init) => {
        request = new Request(input, init)
        return Response.json(token)
      },
    })

    await expect(hookfish.oauth.getToken('personal/gmail')).resolves.toEqual(
      token,
    )
    expect(request?.url).toBe('http://local/api/oauth/tokens/personal%2Fgmail')
    expect(request?.headers.get('Authorization')).toBe('Bearer broker-key')
  })

  it('selects organization-prefixed operations from the constructor', async () => {
    let request: Request | undefined
    const hookfish = new Hookfish({
      apiKey: 'broker-key',
      baseUrl: 'http://local/api',
      organization: 'acme',
      fetch: async (input, init) => {
        request = new Request(input, init)
        return Response.json(token)
      },
    })

    await hookfish.oauth.getToken('personal/gmail')

    expect(request?.url).toBe(
      'http://local/api/organization/acme/oauth/tokens/personal%2Fgmail',
    )
  })

  it('throws an error that preserves the response status', async () => {
    const hookfish = new Hookfish({
      apiKey: 'broker-key',
      baseUrl: 'http://local/api',
      fetch: async () =>
        Response.json(
          { error: { code: 'connection_not_found', message: 'Not found' } },
          { status: 404 },
        ),
    })

    const error = await hookfish.oauth
      .getToken('missing')
      .catch((value) => value)

    expect(error).toBeInstanceOf(HookfishError)
    expect(error).toMatchObject({
      code: 'connection_not_found',
      status: 404,
      message: 'Not found',
    })
  })
})
