import { describe, expect, it, vi } from 'vitest'
import {
  createHookfish,
  HookfishBackend,
  type HookfishBackendAdapter,
} from '../src/index.js'

function createAdapter() {
  const authorize = vi.fn<HookfishBackendAdapter['authorize']>(async () => ({
    status: 'authorization_required',
    authorizeUrl: 'https://arcade.example/authorize/session',
    expiresAt: '2026-08-19T19:00:00.000Z',
  }))
  const adapter: HookfishBackendAdapter = {
    authorize,
    async listProviders() {
      return {
        providers: [
          {
            id: 'google',
            label: 'Google',
            authentication: 'oauth',
          },
        ],
      }
    },
    async listConnections() {
      return []
    },
    async getConnection() {
      return undefined
    },
    async access() {
      return {
        status: 'connected',
        secret: 'arcade-access-token',
      }
    },
    async disconnect() {
      return { deleted: true, revocation: 'revoked' }
    },
  }
  return { adapter, authorize }
}

async function createManagedServer() {
  const { adapter, authorize } = createAdapter()
  const server = await createHookfish(
    {
      backend: new HookfishBackend(adapter),
      auth: {
        authenticate: async () => ({
          authenticated: true,
          principal: { subject: 'user-123', tenantId: 'acme' },
        }),
      },
    },
    { rootApiKey: 'managed-test-key' },
  )
  return { server, authorize }
}

describe('managed Hookfish backend', () => {
  it('delegates OAuth authorization with the verified application principal', async () => {
    const { server, authorize } = await createManagedServer()
    const response = await server.request(
      '/api/client/connections/team/google/authorize',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost',
        },
        body: JSON.stringify({ scopes: ['calendar.read'] }),
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      path: 'team/google',
      authorize_url: 'https://arcade.example/authorize/session',
      expires_at: '2026-08-19T19:00:00.000Z',
    })
    expect(authorize).toHaveBeenCalledOnce()
    const [context, input] = authorize.mock.calls[0]!
    expect(context.principal).toEqual({
      subject: 'user-123',
      tenantId: 'acme',
    })
    expect(input).toMatchObject({
      path: expect.stringMatching(/\/team\/google$/),
      providerId: 'google',
      scopes: ['calendar.read'],
    })
  })

  it('exposes managed providers as OAuth-only', async () => {
    const { server } = await createManagedServer()
    const response = await server.request('/api/client/providers')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      providers: [
        {
          id: 'google',
          label: 'Google',
          authentication: 'oauth',
          input_schema: { fields: [] },
        },
      ],
    })
  })

  it('rejects static secrets before calling the managed backend', async () => {
    const { server } = await createManagedServer()
    const response = await server.request(
      '/api/client/connections/team/openai/secret',
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost',
        },
        body: JSON.stringify({ secret: 'must-not-be-stored' }),
      },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'static_secrets_unsupported',
        message:
          'Managed OAuth backends do not store caller-supplied static secrets.',
      },
    })

    const rawResponse = await server.request(
      '/api/connections/secret/team/openai',
      {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer managed-test-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ secret: 'must-not-be-stored' }),
      },
    )
    expect(rawResponse.status).toBe(409)
    await expect(rawResponse.json()).resolves.toMatchObject({
      error: { code: 'static_secrets_unsupported' },
    })
  })

  it('does not expose database-backed token administration', async () => {
    const { server } = await createManagedServer()
    const response = await server.request('/api/admin/tokens', {
      headers: { Authorization: 'Bearer managed-test-key' },
    })
    expect(response.status).toBe(404)

    const openApiResponse = await server.request('/api/openapi.json')
    const openApi: unknown = await openApiResponse.json()
    expect(openApi).toMatchObject({
      paths: {
        '/connections/access/{connection_path}': expect.any(Object),
      },
    })
    expect(JSON.stringify(openApi)).not.toContain('connections.setSecret')
    expect(JSON.stringify(openApi)).not.toContain('admin.tokens')
  })
})
