import { describe, expect, it, vi } from 'vitest'
import { LinearProvider } from '../src'

const credentials = { clientId: 'linear-client', clientSecret: 'secret' }

describe('LinearProvider', () => {
  it('encapsulates its form-encoded token request', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        access_token: 'linear-token',
        refresh_token: 'linear-refresh',
        expires_in: 3600,
        scope: 'read write',
      }),
    )
    const provider = new LinearProvider({ ...credentials, fetch: fetcher })
    const result = await provider.exchangeCode({
      code: 'code',
      redirectUri: 'https://broker.example/callback',
    })

    const request = fetcher.mock.calls[0]
    const body = new URLSearchParams(String(request?.[1]?.body))
    expect(request?.[0]).toBe('https://api.linear.app/oauth/token')
    expect(request?.[1]?.headers).toMatchObject({
      'Content-Type': 'application/x-www-form-urlencoded',
    })
    expect(Object.fromEntries(body)).toEqual({
      grant_type: 'authorization_code',
      code: 'code',
      redirect_uri: 'https://broker.example/callback',
      client_id: 'linear-client',
      client_secret: 'secret',
    })
    expect(result.payload.access_token).toBe('linear-token')
  })
})
