import { afterEach, describe, expect, it, vi } from 'vitest'
import { authorizeConnection, setConnectionSecret } from './management-api'

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
        configuration: {
          resource_url: 'https://mcp.example.com/notion',
        },
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
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          configuration: {
            resource_url: 'https://mcp.example.com/notion',
          },
          scopes: ['read'],
          return_to: 'https://dashboard.example/connections',
        }),
      }),
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
})
