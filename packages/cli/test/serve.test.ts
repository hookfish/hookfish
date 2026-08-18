import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createOperatorBff,
  operatorSessionCookie,
  proxyBackendRequest,
  resolveBackendUrl,
} from '../src/serve'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('proxyBackendRequest', () => {
  it('passes OAuth redirects back to the browser without following them', async () => {
    const redirect = new Response(null, {
      status: 302,
      headers: { location: 'http://localhost:5173/connections' },
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(redirect)
    const request = new Request(
      'http://localhost:5173/api/oauth/callback/github?code=code&state=state',
      {
        headers: {
          Authorization: 'Bearer application-session',
          Cookie: 'application_session=secret',
        },
      },
    )
    const target = new URL(
      '/api/oauth/callback/github?code=code&state=state',
      'http://127.0.0.1:8787',
    )

    const response = await proxyBackendRequest(request, target)

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      'http://localhost:5173/connections',
    )
    expect(fetchMock).toHaveBeenCalledOnce()
    const [proxiedRequest, init] = fetchMock.mock.calls[0]
    expect(proxiedRequest).toBeInstanceOf(Request)
    if (!(proxiedRequest instanceof Request)) {
      throw new Error('Expected the proxy to pass a Request to fetch.')
    }
    expect(proxiedRequest.url).toBe(target.toString())
    expect(proxiedRequest.headers.get('Authorization')).toBeNull()
    expect(proxiedRequest.headers.get('Cookie')).toBeNull()
    expect(init).toEqual({ redirect: 'manual' })
  })

  it('removes stale compression headers from decoded backend responses', async () => {
    const backendResponse = new Response('{"connections":[]}', {
      headers: {
        'content-encoding': 'gzip',
        'content-length': '38',
        'content-type': 'application/json',
      },
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(backendResponse)

    const response = await proxyBackendRequest(
      new Request('http://localhost:5173/api/client/oauth/connections'),
      new URL('http://127.0.0.1:8787/api/client/oauth/connections'),
    )

    expect(response.headers.get('content-encoding')).toBeNull()
    expect(response.headers.get('content-length')).toBeNull()
    expect(response.headers.get('content-type')).toBe('application/json')
    await expect(response.json()).resolves.toEqual({ connections: [] })
  })
})

describe('resolveBackendUrl', () => {
  it('requires an explicitly configured backend URL', () => {
    expect(() => resolveBackendUrl(undefined, {})).toThrow(
      '--backend-url or HOOKFISH_BACKEND_URL is required',
    )
  })

  it('accepts the CLI option or environment variable', () => {
    expect(resolveBackendUrl('http://localhost:8787', {})).toBe(
      'http://localhost:8787',
    )
    expect(
      resolveBackendUrl(undefined, {
        HOOKFISH_BACKEND_URL: 'https://hookfish.example.com',
      }),
    ).toBe('https://hookfish.example.com')
  })

  it('rejects non-HTTP backend URLs', () => {
    expect(() => resolveBackendUrl('file:///tmp/hookfish', {})).toThrow(
      '--backend-url must use http or https',
    )
  })
})

describe('operator BFF', () => {
  const frontendOrigin = 'http://localhost:5173'
  const sessionToken = 'operator-session'

  function bff() {
    return createOperatorBff({
      backendOrigin: 'http://127.0.0.1:8787',
      frontendOrigin,
      brokerApiKey: 'root-secret',
      sessionToken,
    })
  }

  function request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers)
    headers.set('Cookie', `${operatorSessionCookie}=${sessionToken}`)
    if (init.method && init.method !== 'GET') {
      headers.set('Origin', frontendOrigin)
    }
    return new Request(`${frontendOrigin}${path}`, { ...init, headers })
  }

  it('requires its HttpOnly operator session', async () => {
    expect(bff().sessionCookie()).toContain('HttpOnly')
    expect(bff().sessionCookie()).toContain('SameSite=Strict')
    expect(
      await bff().fetch(
        new Request(`${frontendOrigin}/api/client/connections`),
      ),
    ).toHaveProperty('status', 401)
  })

  it('injects the server credential only for explicit safe operations', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (target, init) => {
        expect(String(target)).toBe('http://127.0.0.1:8787/api/connections')
        expect(new Headers(init?.headers).get('Authorization')).toBe(
          'Bearer root-secret',
        )
        expect(new Headers(init?.headers).get('Cookie')).toBeNull()
        return Response.json({ connections: [] })
      })
    const response = await bff().fetch(request('/api/client/connections'))
    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledOnce()

    const raw = await bff().fetch(request('/api/client/admin/tokens'))
    expect(raw.status).toBe(404)
  })

  it('converts authorization-required into a safe authorization response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        {
          error: {
            code: 'authorization_required',
            message: 'Authorize',
            authorize_url: 'https://provider.example/authorize',
            expires_at: '2030-01-01T00:00:00.000Z',
          },
        },
        { status: 401 },
      ),
    )
    const response = await bff().fetch(
      request('/api/client/connections/team/github/authorize', {
        method: 'POST',
        body: '{}',
      }),
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      path: 'team/github',
      authorize_url: 'https://provider.example/authorize',
      expires_at: '2030-01-01T00:00:00.000Z',
    })
  })

  it('removes credential-shaped fields from successful responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        connection: {
          path: 'team/github',
          metadata: {
            label: 'GitHub',
            access_token: 'provider-secret',
            refreshToken: 'provider-refresh',
          },
          secret: 'stored-secret',
        },
      }),
    )
    const response = await bff().fetch(
      request('/api/client/connections/team/github'),
    )
    await expect(response.json()).resolves.toEqual({
      connection: {
        path: 'team/github',
        metadata: { label: 'GitHub' },
      },
    })
  })
})
