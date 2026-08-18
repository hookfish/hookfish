import { describe, expect, it, vi } from 'vitest'
import {
  type ApplicationAuthProvider,
  createHookfishBackend,
  isAllowedBrowserApiRequest,
} from '../src'

const authenticated = (
  tenantId = 'tenant-a',
): ApplicationAuthProvider<object> => ({
  authenticate: async () => ({
    authenticated: true,
    principal: { subject: 'user-1', tenantId },
  }),
})

describe('Hookfish backend', () => {
  it('passes the raw API through unchanged', async () => {
    const hookfishFetch = vi.fn(async () => new Response('raw'))
    const backend = createHookfishBackend({ config: {}, hookfishFetch })
    const request = new Request('https://backend.example/api/openapi.json')
    expect(await (await backend.fetch(request)).text()).toBe('raw')
    expect(hookfishFetch).toHaveBeenCalledWith(request, undefined, undefined)
  })

  it('requires configured application authentication', async () => {
    const hookfishFetch = vi.fn(async () => Response.json({}))
    const backend = createHookfishBackend({ config: {}, hookfishFetch })
    expect(
      await backend.fetch(
        new Request('https://backend.example/api/client/connections'),
      ),
    ).toHaveProperty('status', 404)
    expect(hookfishFetch).not.toHaveBeenCalled()
  })

  it('authenticates, scopes, and sanitizes connection metadata', async () => {
    const hookfishFetch = vi.fn(async (request: Request) => {
      expect(request.headers.get('Authorization')).toMatch(
        /^Bearer hookfish_app_v1\./,
      )
      expect(request.headers.get('Cookie')).toBeNull()
      expect(request.headers.get('X-Application-Authorization')).toBeNull()
      const namespace = new URL(request.url).searchParams.get('namespace')
      expect(namespace).toMatch(/^__hookfish_application\//)
      return Response.json({
        connections: [
          {
            path: `${namespace}/github`,
            namespace,
            provider_id: 'github',
            configuration: { client_secret: 'remove-me', safe: true },
            metadata: {
              access_token: 'remove-me',
              refreshToken: 'remove-me-too',
              label: 'GitHub',
            },
          },
        ],
      })
    })
    const backend = createHookfishBackend({
      config: { auth: authenticated() },
      hookfishFetch,
      rootApiKey: 'root-secret',
    })
    const response = await backend.fetch(
      new Request(
        'https://backend.example/api/client/connections?namespace=team',
        {
          headers: {
            Cookie: 'session=browser',
            'X-Application-Authorization': 'app-session',
          },
        },
      ),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      connections: [
        {
          path: 'team/github',
          namespace: 'team',
          provider_id: 'github',
          configuration: { safe: true },
          metadata: { label: 'GitHub' },
        },
      ],
    })
  })

  it('maps only explicit safe operations', () => {
    expect(isAllowedBrowserApiRequest('GET', '/api/client/providers')).toBe(
      true,
    )
    expect(isAllowedBrowserApiRequest('GET', '/api/client/connections')).toBe(
      true,
    )
    expect(
      isAllowedBrowserApiRequest(
        'POST',
        '/api/client/connections/team/github/authorize',
      ),
    ).toBe(true)
    expect(
      isAllowedBrowserApiRequest(
        'PUT',
        '/api/client/connections/team/secret/secret',
      ),
    ).toBe(true)
    expect(
      isAllowedBrowserApiRequest('GET', '/api/client/connections/team/github'),
    ).toBe(true)
    expect(isAllowedBrowserApiRequest('GET', '/api/client/admin/tokens')).toBe(
      false,
    )
  })

  it('rejects missing sessions, cross-site mutations, and unknown routes', async () => {
    const hookfishFetch = vi.fn(async () => Response.json({}))
    const backend = createHookfishBackend({
      config: {
        auth: {
          authenticate: async () => ({
            authenticated: false,
            response: Response.json({}, { status: 401 }),
          }),
        },
      },
      hookfishFetch,
      rootApiKey: 'root-secret',
    })
    expect(
      await backend.fetch(
        new Request('https://backend.example/api/client/connections'),
      ),
    ).toHaveProperty('status', 401)

    const authenticatedBackend = createHookfishBackend({
      config: { auth: authenticated() },
      hookfishFetch,
      rootApiKey: 'root-secret',
    })
    expect(
      await authenticatedBackend.fetch(
        new Request(
          'https://backend.example/api/client/connections/team/github',
          { method: 'DELETE', headers: { Origin: 'https://evil.example' } },
        ),
      ),
    ).toHaveProperty('status', 403)
    expect(
      await authenticatedBackend.fetch(
        new Request('https://backend.example/api/client/admin/tokens'),
      ),
    ).toHaveProperty('status', 404)
    expect(hookfishFetch).not.toHaveBeenCalled()
  })

  it('uses disjoint raw namespaces for different tenants', async () => {
    const namespaces: string[] = []
    const hookfishFetch = vi.fn(async (request: Request) => {
      const namespace =
        new URL(request.url).searchParams.get('namespace') ??
        request.headers.get('Authorization') ??
        ''
      namespaces.push(namespace)
      return Response.json({ connections: [] })
    })
    for (const tenantId of ['tenant-a', 'tenant-b']) {
      const backend = createHookfishBackend({
        config: { auth: authenticated(tenantId) },
        hookfishFetch,
        rootApiKey: 'root-secret',
      })
      await backend.fetch(
        new Request(
          'https://backend.example/api/client/connections?namespace=team',
        ),
      )
    }
    expect(namespaces).toHaveLength(2)
    expect(namespaces[0]).not.toBe(namespaces[1])
  })
})
