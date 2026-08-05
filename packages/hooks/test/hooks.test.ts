import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import {
  createHookfishHooks,
  HookfishApiError,
  normalizeApiBaseUrl,
} from '../src'
import { invalidateDisconnectedConnection } from '../src/hooks'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function queryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
}

describe('createHookfishHooks', () => {
  it('normalizes trailing slashes and scopes keys per API instance', () => {
    expect(normalizeApiBaseUrl('/api///')).toBe('/api')
    expect(normalizeApiBaseUrl('/')).toBe('')

    const hookfish = createHookfishHooks({
      baseUrl: 'https://broker.example/api/',
      queryKeyScope: 'primary',
    })

    expect(
      hookfish.keys.connections({
        provider: 'github',
        connection_id_prefix: 'team/payments',
      }),
    ).toEqual([
      'hookfish',
      'primary',
      'connections',
      { provider: 'github', connectionIdPrefix: 'team/payments' },
    ])
    expect(hookfish.keys.connections()).toEqual([
      'hookfish',
      'primary',
      'connections',
      { provider: null, connectionIdPrefix: null },
    ])
  })

  it('uses Hono RPC for typed queries and resolves headers per request', async () => {
    const requests: Request[] = []
    let headerCalls = 0
    const hookfish = createHookfishHooks({
      baseUrl: 'https://broker.example/api/',
      headers: async () => {
        headerCalls += 1
        return { Authorization: 'Bearer session-token' }
      },
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        requests.push(request)
        return jsonResponse({ connections: [] })
      },
    })

    const data = await queryClient().fetchQuery(
      hookfish.options.connections({
        provider: 'github',
        connection_id_prefix: 'team/payments',
      }),
    )

    expect(data).toEqual({ connections: [] })
    expect(headerCalls).toBe(1)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe(
      'https://broker.example/api/oauth/connections?provider=github&connection_id_prefix=team%2Fpayments',
    )
    expect(requests[0]?.headers.get('Authorization')).toBe(
      'Bearer session-token',
    )
  })

  it('sends authorize inputs through the inferred RPC route', async () => {
    const requests: Request[] = []
    const hookfish = createHookfishHooks({
      baseUrl: 'https://broker.example/api',
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        requests.push(request)
        return jsonResponse({
          connection_id: 'swift-orchid-4821',
          authorize_url: 'https://provider.example/authorize',
          expires_at: '2026-08-03T00:00:00.000Z',
        })
      },
    })
    const mutation = hookfish.options.authorize()

    if (!mutation.mutationFn) throw new Error('Missing authorize mutation')

    const result = await mutation.mutationFn(
      {
        provider: 'github',
        connection_id: 'swift-orchid-4821',
        scopes: ['read:user'],
      },
      {
        client: queryClient(),
        meta: undefined,
        mutationKey: mutation.mutationKey,
      },
    )

    expect(result.connection_id).toBe('swift-orchid-4821')
    expect(requests[0]?.method).toBe('POST')
    expect(requests[0]?.url).toBe(
      'https://broker.example/api/oauth/github/authorize',
    )
    await expect(requests[0]?.json()).resolves.toEqual({
      connection_id: 'swift-orchid-4821',
      scopes: ['read:user'],
    })

    await mutation.mutationFn(
      {
        provider: 'github',
        connection_id_prefix: 'team/payments',
      },
      {
        client: queryClient(),
        meta: undefined,
        mutationKey: mutation.mutationKey,
      },
    )

    await expect(requests[1]?.json()).resolves.toEqual({
      connection_id_prefix: 'team/payments',
    })
  })

  it('preserves slashes in connection ids handled by runtime routes', async () => {
    const requests: Request[] = []
    const hookfish = createHookfishHooks({
      baseUrl: 'https://broker.example/api',
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(new Request(input, init))
        return jsonResponse({
          connection: {
            connection_id: 'team/alice',
            provider: 'github',
            scopes: [],
            expires_at: null,
            external_account_id: null,
            external_account_label: null,
            metadata: {},
            created_at: '2026-08-04T00:00:00.000Z',
            updated_at: '2026-08-04T00:00:00.000Z',
          },
        })
      },
    })

    await queryClient().fetchQuery(hookfish.options.connection('team/alice'))

    expect(requests[0]?.url).toBe(
      'https://broker.example/api/oauth/connections/team/alice',
    )
  })

  it('throws a structured error for broker responses', async () => {
    const hookfish = createHookfishHooks({
      baseUrl: 'https://broker.example/api',
      fetch: async () =>
        jsonResponse(
          {
            error: {
              code: 'unauthorized',
              message: 'Sign in first.',
            },
          },
          401,
        ),
    })

    const request = queryClient().fetchQuery(hookfish.options.providers())

    await expect(request).rejects.toEqual(
      expect.objectContaining<Partial<HookfishApiError>>({
        name: 'HookfishApiError',
        status: 401,
        code: 'unauthorized',
        message: 'Sign in first.',
      }),
    )
  })

  it('does not expose the server-only token route as an option or hook', () => {
    const hookfish = createHookfishHooks()

    expect(Object.keys(hookfish.options)).not.toContain('token')
    expect(Object.keys(hookfish)).not.toContain('useAccessToken')
  })

  it('removes disconnected details and invalidates every connection list', async () => {
    const hookfish = createHookfishHooks({ queryKeyScope: 'cache-test' })
    const client = queryClient()
    const connectionId = 'swift-orchid-4821'
    const allConnections = hookfish.keys.connections()
    const githubConnections = hookfish.keys.connections({
      provider: 'github',
    })

    client.setQueryData(hookfish.keys.connection(connectionId), {
      connection: { connection_id: connectionId },
    })
    client.setQueryData(allConnections, { connections: [] })
    client.setQueryData(githubConnections, { connections: [] })

    await invalidateDisconnectedConnection(client, hookfish.keys, connectionId)

    expect(client.getQueryData(hookfish.keys.connection(connectionId))).toBe(
      undefined,
    )
    expect(client.getQueryState(allConnections)?.isInvalidated).toBe(true)
    expect(client.getQueryState(githubConnections)?.isInvalidated).toBe(true)
  })
})
