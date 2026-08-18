import { afterEach, describe, expect, it, vi } from 'vitest'
import { authorizeConnection, setConnectionSecret } from './management-api'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('application connection API', () => {
  it('starts authorization without sending a broker credential', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        path: 'team/notion',
        authorize_url: 'https://notion.example/authorize',
        expires_at: '2030-01-01T00:00:00.000Z',
      }),
    )
    await expect(
      authorizeConnection('team/notion', 'notion', {
        scopes: ['read'],
        returnTo: 'https://app.example/connections',
      }),
    ).resolves.toEqual({
      path: 'team/notion',
      providerId: 'notion',
      authorizeUrl: 'https://notion.example/authorize',
      expiresAt: '2030-01-01T00:00:00.000Z',
    })

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('/api/client/connections/team/notion/authorize')
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(new Headers(init?.headers).get('Authorization')).toBeNull()
  })

  it('stores a provider secret and receives no secret value back', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ path: 'team/secret', stored: true }))
    await setConnectionSecret('team/secret', 'sk-example')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('/api/client/connections/team/secret/secret')
    expect(init).toMatchObject({
      method: 'PUT',
      credentials: 'include',
      body: JSON.stringify({ secret: 'sk-example' }),
    })
    expect(new Headers(init?.headers).get('Authorization')).toBeNull()
  })
})
