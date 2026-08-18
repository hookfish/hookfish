import { describe, expect, it, vi } from 'vitest'
import {
  type ApplicationAuthProvider,
  createHookfishClient,
  isAllowedBrowserApiRequest,
} from '../src'

const authenticated = (
  basePath: string | null = 'organizations/acme',
): ApplicationAuthProvider<object> => ({
  authenticate: async () => ({
    authenticated: true,
    principal: { subject: 'user-1', basePath },
  }),
})

describe('Hookfish client app', () => {
  it('is a Hono app that does not mount the raw API', async () => {
    const app = createHookfishClient({
      auth: authenticated(),
      backendUrl: 'https://api.example',
      apiKey: 'root-secret',
    })
    expect(
      await app.fetch(new Request('https://frontend.example/api/openapi.json')),
    ).toHaveProperty('status', 404)
  })

  it('reports the authenticated canonical base path', async () => {
    const app = createHookfishClient({
      auth: authenticated('organizations/acme'),
      backendUrl: 'https://api.example',
      apiKey: 'root-secret',
    })
    const response = await app.fetch(
      new Request('https://frontend.example/api/client/context'),
    )
    await expect(response.json()).resolves.toEqual({
      subject: 'user-1',
      basePath: 'organizations/acme',
      scopes: ['organizations/acme/**'],
    })
  })

  it('retains a root or downscoped API token when no base path is resolved', async () => {
    const backendFetch = vi.fn(async (request: Request) => {
      expect(request.url).toBe('https://api.example/api/access')
      expect(request.headers.get('Authorization')).toBe('Bearer scoped-token')
      return Response.json({
        kind: 'scoped',
        scopes: ['organizations/acme/**'],
      })
    })
    const app = createHookfishClient({
      auth: authenticated(null),
      backendUrl: 'https://api.example',
      apiKey: 'scoped-token',
      fetch: backendFetch,
    })
    const response = await app.fetch(
      new Request('https://frontend.example/api/client/context'),
    )
    await expect(response.json()).resolves.toEqual({
      subject: 'user-1',
      basePath: 'organizations/acme',
      scopes: ['organizations/acme/**'],
    })
  })

  it('preserves canonical paths while scoping and sanitizing requests', async () => {
    const backendFetch = vi.fn(async (request: Request) => {
      expect(request.url).toBe(
        'https://api.example/api/connections?namespace=organizations%2Facme',
      )
      expect(request.headers.get('Authorization')).toMatch(
        /^Bearer hookfish_app_v1\./,
      )
      expect(request.headers.get('Cookie')).toBeNull()
      expect(request.headers.get('X-Hookfish-Application-Base-Path')).toBe(
        'organizations/acme',
      )
      return Response.json({
        connections: [
          {
            path: 'organizations/acme/github',
            namespace: 'organizations/acme',
            provider_id: 'github',
            configuration: { client_secret: 'remove-me', safe: true },
            metadata: { access_token: 'remove-me', label: 'GitHub' },
          },
        ],
      })
    })
    const app = createHookfishClient({
      auth: authenticated(),
      backendUrl: 'https://api.example',
      apiKey: 'root-secret',
      fetch: backendFetch,
    })
    const response = await app.fetch(
      new Request('https://frontend.example/api/client/connections'),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      connections: [
        {
          path: 'organizations/acme/github',
          namespace: 'organizations/acme',
          provider_id: 'github',
          configuration: { safe: true },
          metadata: { label: 'GitHub' },
        },
      ],
    })
  })

  it('maps only the explicit browser-safe operations', () => {
    expect(isAllowedBrowserApiRequest('GET', '/api/client/context')).toBe(true)
    expect(isAllowedBrowserApiRequest('GET', '/api/client/providers')).toBe(
      true,
    )
    expect(isAllowedBrowserApiRequest('GET', '/api/client/connections')).toBe(
      true,
    )
    expect(
      isAllowedBrowserApiRequest(
        'POST',
        '/api/client/connections/organizations/acme/github/authorize',
      ),
    ).toBe(true)
    expect(isAllowedBrowserApiRequest('GET', '/api/client/admin/tokens')).toBe(
      false,
    )
  })

  it('rejects missing sessions, cross-site mutations, and paths outside the base', async () => {
    const backendFetch = vi.fn(async () => Response.json({}))
    const unauthenticated = createHookfishClient({
      auth: {
        authenticate: async () => ({
          authenticated: false,
          response: Response.json({}, { status: 401 }),
        }),
      },
      backendUrl: 'https://api.example',
      apiKey: 'root-secret',
      fetch: backendFetch,
    })
    expect(
      await unauthenticated.fetch(
        new Request('https://frontend.example/api/client/connections'),
      ),
    ).toHaveProperty('status', 401)

    const app = createHookfishClient({
      auth: authenticated(),
      backendUrl: 'https://api.example',
      apiKey: 'root-secret',
      fetch: backendFetch,
    })
    expect(
      await app.fetch(
        new Request(
          'https://frontend.example/api/client/connections/organizations/acme/github',
          { method: 'DELETE', headers: { Origin: 'https://evil.example' } },
        ),
      ),
    ).toHaveProperty('status', 403)
    expect(
      await app.fetch(
        new Request(
          'https://frontend.example/api/client/connections/organizations/other/github',
        ),
      ),
    ).toHaveProperty('status', 403)
    expect(backendFetch).not.toHaveBeenCalled()
  })

  it('rejects backend records outside the authenticated base path', async () => {
    const app = createHookfishClient({
      auth: authenticated(),
      backendUrl: 'https://api.example',
      apiKey: 'root-secret',
      fetch: async () =>
        Response.json({
          connections: [
            {
              path: 'organizations/other/github',
              namespace: 'organizations/other',
            },
          ],
        }),
    })
    const response = await app.fetch(
      new Request('https://frontend.example/api/client/connections'),
    )
    expect(response.status).toBe(502)
  })

  it('returns a controlled error for a malformed namespace', async () => {
    const backendFetch = vi.fn(async () => Response.json({ connections: [] }))
    const app = createHookfishClient({
      auth: authenticated('global'),
      backendUrl: 'https://api.example',
      apiKey: 'root-secret',
      fetch: backendFetch,
    })
    const response = await app.fetch(
      new Request(
        'https://frontend.example/api/client/connections?namespace=global%2F',
      ),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'invalid_client_resource_path',
        message:
          'Browser resource paths must use canonical slash-delimited identifiers.',
      },
    })
    expect(backendFetch).not.toHaveBeenCalled()
  })
})
