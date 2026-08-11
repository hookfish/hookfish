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

    expect(response).toBe(redirect)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [proxiedRequest, init] = fetchMock.mock.calls[0]
    expect(proxiedRequest).toBeInstanceOf(Request)
    if (!(proxiedRequest instanceof Request)) {
      throw new Error('Expected the proxy to pass a Request to fetch.')
    }
    expect(proxiedRequest.url).toBe(target.toString())
    expect(init).toEqual({ redirect: 'manual' })
  })
})
