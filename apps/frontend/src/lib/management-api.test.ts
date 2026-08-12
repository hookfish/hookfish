import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  authorizeConnection,
  listSecrets,
  setConnectionSecret,
} from './management-api'

afterEach(() => vi.unstubAllGlobals())

describe('management API', () => {
  it('turns authorization-required responses into pending authorizations', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'authorization_required',
            message: 'Authorize this connection.',
            authorize_url: 'https://provider.example/authorize',
            expires_at: '2026-08-12T20:00:00.000Z',
          },
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      authorizeConnection('token', 'team/notion', 'notion', {
        scopes: ['read'],
        returnTo: 'https://dashboard.example/connections',
      }),
    ).resolves.toEqual({
      path: 'team/notion',
      providerId: 'notion',
      authorizeUrl: 'https://provider.example/authorize',
      expiresAt: '2026-08-12T20:00:00.000Z',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/connections/authorize/team/notion',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('writes provider secrets through the unified connection endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ path: 'team/openai/secret', stored: true }),
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    await setConnectionSecret('token', 'team/openai/secret', 'sk-example')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/connections/secret/team/openai/secret',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ secret: 'sk-example' }),
      }),
    )
  })

  it('lists vault metadata for the current tree path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          secrets: [
            {
              path: 'team/openai',
              created_at: '2026-08-12T20:00:00.000Z',
              updated_at: '2026-08-12T20:00:00.000Z',
            },
          ],
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(listSecrets('token', 'team')).resolves.toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/secrets?path_prefix=team',
      expect.any(Object),
    )
  })
})
