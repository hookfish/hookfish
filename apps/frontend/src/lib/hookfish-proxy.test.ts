import { describe, expect, it, vi } from 'vitest'
import {
  createHookfishServerFetch,
  isAllowedHookfishProxyRequest,
  validateHookfishProxyRequest,
} from './hookfish-proxy'

describe('Hookfish server-function proxy', () => {
  it('allows only the frontend-safe API surface', () => {
    expect(
      isAllowedHookfishProxyRequest({
        method: 'GET',
        path: '/api/oauth/providers',
      }),
    ).toBe(true)
    expect(
      isAllowedHookfishProxyRequest({
        method: 'GET',
        path: '/api/oauth/connections/team/alice',
      }),
    ).toBe(true)
    expect(
      isAllowedHookfishProxyRequest({
        method: 'POST',
        path: '/api/oauth/github/authorize',
        body: '{}',
      }),
    ).toBe(true)
    expect(
      isAllowedHookfishProxyRequest({
        method: 'DELETE',
        path: '/api/oauth/connections/team/alice',
      }),
    ).toBe(true)

    expect(
      isAllowedHookfishProxyRequest({
        method: 'GET',
        path: '/api/oauth/tokens/team/alice',
      }),
    ).toBe(false)
    expect(
      isAllowedHookfishProxyRequest({
        method: 'GET',
        path: '/api/openapi.json',
      }),
    ).toBe(false)
    expect(
      isAllowedHookfishProxyRequest({
        method: 'GET',
        path: '/api/oauth/github/callback?code=secret',
      }),
    ).toBe(false)
  })

  it('validates methods, paths, and request size', () => {
    expect(
      validateHookfishProxyRequest({
        method: 'POST',
        path: '/api/oauth/github/authorize',
        body: '{}',
      }),
    ).toEqual({
      method: 'POST',
      path: '/api/oauth/github/authorize',
      body: '{}',
    })

    expect(() =>
      validateHookfishProxyRequest({
        method: 'PUT',
        path: '/api/oauth/connections/example',
      }),
    ).toThrow('Unsupported Hookfish request method')
    expect(() =>
      validateHookfishProxyRequest({
        method: 'GET',
        path: 'https://evil.test',
      }),
    ).toThrow('Invalid Hookfish request path')
    expect(() =>
      validateHookfishProxyRequest({
        method: 'POST',
        path: '/api/oauth/github/authorize',
        body: 'x'.repeat(65_537),
      }),
    ).toThrow('Hookfish request body is too large')
  })

  it('serializes Hono fetch requests without forwarding browser headers', async () => {
    const serverFunction = vi.fn(async () => Response.json({ connections: [] }))
    const proxyFetch = createHookfishServerFetch(serverFunction)

    const response = await proxyFetch(
      'https://browser.example/api/oauth/github/authorize',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer browser-value' },
        body: '{"scopes":[]}',
      },
    )

    expect(await response.json()).toEqual({ connections: [] })
    expect(serverFunction).toHaveBeenCalledWith({
      data: {
        method: 'POST',
        path: '/api/oauth/github/authorize',
        body: '{"scopes":[]}',
      },
    })
  })
})
