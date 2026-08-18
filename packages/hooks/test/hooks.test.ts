import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import {
  createHookfishHooks,
  HookfishApiError,
  normalizeApiBaseUrl,
} from '../src'
import { invalidateDisconnectedConnection } from '../src/hooks'

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

function queryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
}

describe('createHookfishHooks', () => {
  it('normalizes base URLs and keys connection metadata filters', () => {
    expect(normalizeApiBaseUrl('/api///')).toBe('/api')
    expect(normalizeApiBaseUrl('/')).toBe('')

    const hookfish = createHookfishHooks({ queryKeyScope: 'primary' })
    expect(
      hookfish.keys.connections({
        provider_id: 'github',
        namespace: 'user/personal',
      }),
    ).toEqual([
      'hookfish',
      'primary',
      'connections',
      { namespace: 'user/personal', providerId: 'github' },
    ])
  })

  it('lists connection metadata through the browser-safe route', async () => {
    const requests: Request[] = []
    const hookfish = createHookfishHooks({
      baseUrl: 'https://broker.example/api/client/',
      headers: async () => ({ Authorization: 'Bearer application-session' }),
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(new Request(input, init))
        return jsonResponse({ connections: [] })
      },
    })

    await queryClient().fetchQuery(
      hookfish.options.connections({
        provider_id: 'github',
        namespace: 'user/personal',
      }),
    )

    expect(requests[0]?.url).toBe(
      'https://broker.example/api/client/connections?namespace=user%2Fpersonal&provider_id=github',
    )
    expect(requests[0]?.headers.get('Authorization')).toBe(
      'Bearer application-session',
    )
  })

  it('preserves slash-delimited paths on metadata routes', async () => {
    const requests: Request[] = []
    const hookfish = createHookfishHooks({
      baseUrl: 'https://broker.example/api/client',
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(new Request(input, init))
        return jsonResponse({ connection: { path: 'user/personal/github' } })
      },
    })

    await queryClient().fetchQuery(
      hookfish.options.connection('user/personal/github'),
    )
    expect(requests[0]?.url).toBe(
      'https://broker.example/api/client/connections/user/personal/github',
    )
  })

  it('throws structured broker errors', async () => {
    const hookfish = createHookfishHooks({
      fetch: async () =>
        jsonResponse(
          { error: { code: 'unauthorized', message: 'Sign in first.' } },
          401,
        ),
    })

    await expect(
      queryClient().fetchQuery(hookfish.options.providers()),
    ).rejects.toEqual(
      expect.objectContaining<Partial<HookfishApiError>>({
        name: 'HookfishApiError',
        status: 401,
        code: 'unauthorized',
        message: 'Sign in first.',
      }),
    )
  })

  it('invalidates metadata after disconnect and exposes no secret access hook', async () => {
    const hookfish = createHookfishHooks({ queryKeyScope: 'cache-test' })
    const client = queryClient()
    const path = 'user/personal/github'
    client.setQueryData(hookfish.keys.connection(path), {
      connection: { path },
    })
    client.setQueryData(hookfish.keys.connections(), { connections: [] })

    await invalidateDisconnectedConnection(client, hookfish.keys, path)

    expect(client.getQueryData(hookfish.keys.connection(path))).toBeUndefined()
    expect(
      client.getQueryState(hookfish.keys.connections())?.isInvalidated,
    ).toBe(true)
    expect(Object.keys(hookfish)).not.toContain('useAccessConnection')
    expect(Object.keys(hookfish)).not.toContain('useAuthorizeConnection')
  })
})
