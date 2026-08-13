import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  authorizeConnection,
  getConnectionToken,
  setConnectionSecret,
  validateBrokerToken,
} from './management-api'

afterEach(() => vi.unstubAllGlobals())

describe('management API', () => {
  it('validates a broker API key before the frontend stores it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ providers: [] })))
    vi.stubGlobal('fetch', fetchMock)

    await expect(validateBrokerToken('broker-key')).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/connections/providers',
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    )
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get('Authorization')).toBe('Bearer broker-key')
  })

  it('rejects an invalid broker API key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'unauthorized', message: 'Invalid broker API key.' },
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )

    await expect(validateBrokerToken('invalid')).rejects.toThrow(
      'Invalid broker API key.',
    )
  })

  it('fetches a connection token only through explicit access', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ secret: 'provider-token' })),
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      getConnectionToken('broker-key', 'team/notion', 'notion'),
    ).resolves.toEqual({ ready: true, secret: 'provider-token' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/connections/access/team/notion',
      expect.objectContaining({
        method: 'POST',
      }),
    )
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBeUndefined()
  })

  it('returns authorization details instead of a token when required', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
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
      ),
    )

    await expect(
      getConnectionToken('broker-key', 'team/notion', 'notion'),
    ).resolves.toEqual({
      ready: false,
      authorization: {
        path: 'team/notion',
        providerId: 'notion',
        authorizeUrl: 'https://provider.example/authorize',
        expiresAt: '2026-08-12T20:00:00.000Z',
      },
    })
  })

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
