import { describe, expect, it, vi } from 'vitest'
import {
  browserApiPath,
  createHookfishBackend,
  isAllowedBrowserApiRequest,
} from '../src'

describe('Hookfish backend', () => {
  it('passes the raw Hookfish API through unchanged', async () => {
    const hookfishFetch = vi.fn(async () => new Response('raw'))
    const backend = createHookfishBackend({
      config: {},
      hookfishFetch,
    })
    const request = new Request('https://backend.example/api/openapi.json')

    expect(await (await backend.fetch(request)).text()).toBe('raw')
    expect(hookfishFetch).toHaveBeenCalledWith(request, undefined, undefined)
  })

  it('forwards only browser-safe routes with a server credential', async () => {
    const hookfishFetch = vi.fn(async (request: Request) => {
      expect(request.url).toBe(
        'https://backend.example/api/oauth/connections?provider=github',
      )
      expect(request.headers.get('Authorization')).toBe('Bearer root-secret')
      expect(request.headers.get('Cookie')).toBeNull()
      expect(request.headers.get('X-Browser-Value')).toBeNull()
      return Response.json({ connections: [] })
    })
    const backend = createHookfishBackend({
      config: { includeClient: true },
      hookfishFetch,
      brokerApiKey: 'root-secret',
    })

    const response = await backend.fetch(
      new Request(
        'https://backend.example/api/client/oauth/connections?provider=github',
        {
          headers: {
            Cookie: 'session=browser',
            'X-Browser-Value': 'do-not-forward',
          },
        },
      ),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ connections: [] })
  })

  it('forwards bounded JSON mutation bodies', async () => {
    const hookfishFetch = vi.fn(async (request: Request) => {
      expect(request.method).toBe('POST')
      expect(request.headers.get('Content-Type')).toBe('application/json')
      expect(await request.text()).toBe('{"scopes":[]}')
      return Response.json({ authorize_url: 'https://provider.example' })
    })
    const backend = createHookfishBackend({
      config: { includeClient: true },
      hookfishFetch,
      brokerApiKey: 'root-secret',
    })

    const response = await backend.fetch(
      new Request(
        'https://backend.example/api/client/oauth/github/authorize?source=ui',
        { method: 'POST', body: '{"scopes":[]}' },
      ),
    )

    expect(response.status).toBe(200)
    expect(hookfishFetch).toHaveBeenCalledOnce()
  })

  it('rejects token, callback, and unsupported browser routes', async () => {
    expect(
      isAllowedBrowserApiRequest('GET', '/api/oauth/tokens/team/alice'),
    ).toBe(false)
    expect(
      isAllowedBrowserApiRequest('GET', '/api/oauth/github/callback'),
    ).toBe(false)
    expect(isAllowedBrowserApiRequest('PUT', '/api/stats')).toBe(false)

    const hookfishFetch = vi.fn(async () => Response.json({ unexpected: true }))
    const backend = createHookfishBackend({
      config: { includeClient: true },
      hookfishFetch,
    })
    const response = await backend.fetch(
      new Request('https://backend.example/api/client/oauth/tokens/team/alice'),
    )

    expect(response.status).toBe(403)
    expect(hookfishFetch).not.toHaveBeenCalled()
  })

  it('serves backend health without forwarding to Hookfish', async () => {
    const hookfishFetch = vi.fn(async () => new Response())
    const backend = createHookfishBackend({
      config: { includeClient: true },
      hookfishFetch,
      runtime: 'cloudflare-worker',
    })
    const response = await backend.fetch(
      new Request(`https://backend.example${browserApiPath}/health`),
    )
    const health = await response.json()

    expect(health).toMatchObject({ ok: true, runtime: 'cloudflare-worker' })
    expect(health.checkedAt).toEqual(expect.any(String))
    expect(hookfishFetch).not.toHaveBeenCalled()
  })

  it('uses configured trusted origins for cross-origin access and preflight', async () => {
    const backend = createHookfishBackend({
      config: {
        includeClient: true,
        trustedOrigins: ['http://localhost:5173'],
      },
      hookfishFetch: async () => Response.json({}),
    })
    const allowed = await backend.fetch(
      new Request('https://backend.example/api/client/health', {
        headers: { Origin: 'http://localhost:5173' },
      }),
    )
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:5173',
    )

    const preflight = await backend.fetch(
      new Request('https://backend.example/api/client/oauth/github/authorize', {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:5173' },
      }),
    )
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toContain(
      'POST',
    )

    const denied = await backend.fetch(
      new Request('https://backend.example/api/client/health', {
        headers: { Origin: 'https://evil.example' },
      }),
    )
    expect(denied.status).toBe(403)
  })

  it('runs application authorization before browser requests', async () => {
    const hookfishFetch = vi.fn(async () => Response.json({}))
    const backend = createHookfishBackend({
      config: { includeClient: true },
      hookfishFetch,
      authorizeBrowserRequest: () =>
        Response.json({ error: 'sign in' }, { status: 401 }),
    })
    const response = await backend.fetch(
      new Request('https://backend.example/api/client/health'),
    )

    expect(response.status).toBe(401)
    expect(hookfishFetch).not.toHaveBeenCalled()
  })

  it('rejects oversized browser request bodies', async () => {
    const hookfishFetch = vi.fn(async () => Response.json({}))
    const backend = createHookfishBackend({
      config: { includeClient: true },
      hookfishFetch,
    })
    const response = await backend.fetch(
      new Request('https://backend.example/api/client/oauth/github/authorize', {
        method: 'POST',
        body: 'x'.repeat(65_537),
      }),
    )

    expect(response.status).toBe(413)
    expect(hookfishFetch).not.toHaveBeenCalled()
  })

  it('does not mount the client facade unless enabled', async () => {
    const hookfishFetch = vi.fn(async () => Response.json({}))
    const backend = createHookfishBackend({ config: {}, hookfishFetch })

    expect(
      await backend.fetch(
        new Request('https://backend.example/api/client/health'),
      ),
    ).toHaveProperty('status', 404)
    expect(hookfishFetch).not.toHaveBeenCalled()
  })
})
