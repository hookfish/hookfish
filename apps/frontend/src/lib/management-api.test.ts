import { afterEach, describe, expect, it, vi } from 'vitest'
import { deleteManagedProvider, storeManagedProvider } from './management-api'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('provider management RPC', () => {
  it('preserves Hono JSON headers when adding broker authorization', async () => {
    const request = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        expect(String(input)).toBe('/api/admin/providers/team/mcp-notion')
        const headers = new Headers(init?.headers)
        expect(headers.get('authorization')).toBe('Bearer test-token')
        expect(headers.get('content-type')).toBe('application/json')
        expect(JSON.parse(String(init?.body))).toEqual({
          template: 'mcp',
          enabled: true,
          configuration: {
            resource_url: 'https://mcp.notion.com/mcp',
            scopes: [],
          },
          credentials: { mode: 'register' },
        })

        return Response.json({
          provider: {
            id: 'team/mcp-notion',
            template: 'mcp',
            label: 'MCP server',
            source: 'dynamic',
            configured: true,
            enabled: true,
            credentials: {
              mode: 'custom',
              client_id: 'https://example.com/client-metadata.json',
            },
            configuration: {
              resource_url: 'https://mcp.notion.com/mcp',
              scopes: [],
            },
            callback_url:
              'https://broker.example.com/api/oauth/callback/team/mcp-notion',
            created_at: '2026-08-10T00:00:00.000Z',
            updated_at: '2026-08-10T00:00:00.000Z',
          },
        })
      },
    )
    vi.stubGlobal('fetch', request)

    await storeManagedProvider('test-token', {
      id: 'team/mcp-notion',
      template: 'mcp',
      type: 'mcp',
      resourceUrl: 'https://mcp.notion.com/mcp',
      scopes: [],
    })

    expect(request).toHaveBeenCalledOnce()
  })

  it('deletes nested provider paths through the typed client', async () => {
    const request = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        expect(String(input)).toBe('/api/admin/providers/team/mcp-notion')
        expect(init?.method).toBe('DELETE')
        expect(new Headers(init?.headers).get('authorization')).toBe(
          'Bearer test-token',
        )
        return Response.json({ id: 'team/mcp-notion', deleted: true })
      },
    )
    vi.stubGlobal('fetch', request)

    await deleteManagedProvider('test-token', 'team/mcp-notion')

    expect(request).toHaveBeenCalledOnce()
  })
})
