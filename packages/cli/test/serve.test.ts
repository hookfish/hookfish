import { afterEach, describe, expect, it, vi } from 'vitest'
import { proxyBackendRequest } from '../src/serve'

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
