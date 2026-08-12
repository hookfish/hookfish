import { describe, expect, it, vi } from 'vitest'
import {
  browserApiPath,
  createHookfishBackend,
  isAllowedBrowserApiRequest,
} from '../src'

describe('Hookfish backend', () => {
  it('passes the raw API through unchanged', async () => {
    const hookfishFetch = vi.fn(async () => new Response('raw'))
    const backend = createHookfishBackend({ config: {}, hookfishFetch })
    const request = new Request('https://backend.example/api/openapi.json')
    expect(await (await backend.fetch(request)).text()).toBe('raw')
    expect(hookfishFetch).toHaveBeenCalledWith(request, undefined, undefined)
  })

  it('forwards connection metadata with a server credential', async () => {
    const hookfishFetch = vi.fn(async (request: Request) => {
      expect(request.url).toBe(
        'https://backend.example/api/connections?provider_id=github',
      )
      expect(request.headers.get('Authorization')).toBe('Bearer root-secret')
      expect(request.headers.get('Cookie')).toBeNull()
      return Response.json({ connections: [] })
    })
    const backend = createHookfishBackend({
      config: { includeClient: true },
      hookfishFetch,
      brokerApiKey: 'root-secret',
    })
    const response = await backend.fetch(
      new Request(
        'https://backend.example/api/client/connections?provider_id=github',
        { headers: { Cookie: 'session=browser' } },
      ),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('allows metadata and disconnect but rejects credential routes', () => {
    expect(isAllowedBrowserApiRequest('GET', '/api/connections')).toBe(true)
    expect(
      isAllowedBrowserApiRequest(
        'GET',
        '/api/connections/entry/user/personal/github',
      ),
    ).toBe(true)
    expect(
      isAllowedBrowserApiRequest(
        'DELETE',
        '/api/connections/entry/user/personal/github',
      ),
    ).toBe(true)
    expect(
      isAllowedBrowserApiRequest(
        'POST',
        '/api/connections/access/user/personal/github',
      ),
    ).toBe(false)
    expect(
      isAllowedBrowserApiRequest(
        'PUT',
        '/api/connections/secret/service/openai/secret',
      ),
    ).toBe(false)
    expect(
      isAllowedBrowserApiRequest('GET', '/api/connections/callback/github'),
    ).toBe(false)
    expect(isAllowedBrowserApiRequest('GET', '/api/secrets/key')).toBe(false)
  })

  it('serves health without forwarding', async () => {
    const hookfishFetch = vi.fn(async () => new Response())
    const backend = createHookfishBackend({
      config: { includeClient: true },
      hookfishFetch,
      runtime: 'cloudflare-worker',
    })
    const response = await backend.fetch(
      new Request(`https://backend.example${browserApiPath}/health`),
    )
    expect(await response.json()).toMatchObject({
      ok: true,
      runtime: 'cloudflare-worker',
    })
    expect(hookfishFetch).not.toHaveBeenCalled()
  })

  it('enforces origin and application authorization', async () => {
    const hookfishFetch = vi.fn(async () => Response.json({}))
    const backend = createHookfishBackend({
      config: {
        includeClient: true,
        trustedOrigins: ['http://localhost:5173'],
      },
      hookfishFetch,
      authorizeBrowserRequest: () =>
        Response.json({ error: 'sign in' }, { status: 401 }),
    })
    const deniedOrigin = await backend.fetch(
      new Request('https://backend.example/api/client/connections', {
        headers: { Origin: 'https://evil.example' },
      }),
    )
    expect(deniedOrigin.status).toBe(403)

    const deniedSession = await backend.fetch(
      new Request('https://backend.example/api/client/connections', {
        headers: { Origin: 'http://localhost:5173' },
      }),
    )
    expect(deniedSession.status).toBe(401)
    expect(hookfishFetch).not.toHaveBeenCalled()
  })

  it('does not mount the facade unless enabled', async () => {
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
