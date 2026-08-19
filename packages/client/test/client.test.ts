import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHookfishClient } from '../src/index'

const frontendOrigin = 'http://localhost:5173'
const sessionToken = 'operator-session'

function client() {
  return createHookfishClient({
    apiUrl: 'http://127.0.0.1:8787',
    apiKey: () => 'root-secret',
    frontendOrigin,
    sessionToken,
    fallback: () =>
      new Response('<!doctype html><title>Hookfish</title>', {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createHookfishClient', () => {
  it('is a mountable Hono app that delegates pages to its host', async () => {
    const response = await client().request('/')

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<title>Hookfish</title>')
    expect(response.headers.get('set-cookie')).toContain(
      'hookfish_operator_session=operator-session',
    )
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(response.headers.get('content-security-policy')).toContain(
      "default-src 'self'",
    )
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-frame-options')).toBe('DENY')
  })

  it('marks its session cookie secure behind a TLS-terminating proxy', async () => {
    const response = await client().request('/', {
      headers: { 'x-forwarded-proto': 'https' },
    })

    expect(response.headers.get('set-cookie')).toContain('; Secure')
  })

  it('recognizes the standard Forwarded header from a TLS proxy', async () => {
    const response = await client().request('/', {
      headers: { forwarded: 'for=192.0.2.10;proto="https";host=hookfish.test' },
    })

    expect(response.headers.get('set-cookie')).toContain('; Secure')
  })

  it('preserves stricter security headers from the frontend host', async () => {
    const app = createHookfishClient({
      apiUrl: 'http://127.0.0.1:8787',
      apiKey: 'root-secret',
      frontendOrigin,
      sessionToken,
      fallback: () =>
        new Response('<!doctype html>', {
          headers: {
            'content-type': 'text/html',
            'content-security-policy': "default-src 'none'",
          },
        }),
    })

    const response = await app.request('/')

    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'none'",
    )
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('maps safe client operations to the separate Hookfish API', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (target, init) => {
        expect(String(target)).toBe(
          'http://127.0.0.1:8787/api/connections/providers',
        )
        expect(new Headers(init?.headers).get('authorization')).toBe(
          'Bearer root-secret',
        )
        return Response.json({ providers: ['github'] })
      })

    const response = await client().request('/api/client/providers', {
      headers: {
        cookie: 'hookfish_operator_session=operator-session',
      },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ providers: ['github'] })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('does not expose arbitrary Hookfish API routes', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    const response = await client().request('/api/admin/tokens')

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<title>Hookfish</title>')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('proxies public OAuth callbacks without a server credential', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: `${frontendOrigin}/connections` },
      }),
    )

    const response = await client().request(
      '/api/connections/callback/github?code=code&state=state',
      {
        headers: {
          authorization: 'Bearer browser-value',
          cookie: 'browser-cookie=value',
        },
      },
    )

    expect(response.status).toBe(302)
    const [request] = fetchMock.mock.calls[0]
    expect(request).toBeInstanceOf(Request)
    if (!(request instanceof Request)) {
      throw new Error('Expected a proxied Request.')
    }
    expect(request.headers.get('authorization')).toBeNull()
    expect(request.headers.get('cookie')).toBeNull()
  })
})
