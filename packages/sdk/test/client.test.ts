import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { Hookfish, HookfishError } from '../src'

const access = {
  path: 'user/personal/gmail',
  secret: 'gmail-token',
  scopes: [],
  expires_at: null,
  refreshed: false,
}

describe('Hookfish', () => {
  it('accesses a slash-delimited connection path', async () => {
    let request: Request | undefined
    const hookfish = new Hookfish({
      apiKey: 'broker-key',
      baseUrl: 'http://local/api',
      fetch: async (input, init) => {
        request = new Request(input, init)
        return Response.json(access)
      },
    })

    await expect(
      hookfish.connections.access('user/personal/gmail'),
    ).resolves.toEqual(access)
    expect(request?.url).toBe(
      'http://local/api/connections/access/user%2Fpersonal%2Fgmail',
    )
    expect(request?.headers.get('Authorization')).toBe('Bearer broker-key')
  })

  it('sends generic provider configuration', async () => {
    let request: Request | undefined
    const hookfish = new Hookfish({
      apiKey: 'broker-key',
      baseUrl: 'http://local/api',
      fetch: async (input, init) => {
        request = new Request(input, init)
        return Response.json(access)
      },
    })

    await hookfish.connections.access('user/personal/gmail/mcp', {
      configuration: { resource_url: 'https://gmail.run.tools' },
      scopes: ['read'],
    })

    await expect(request?.json()).resolves.toMatchObject({
      configuration: {
        resource_url: 'https://gmail.run.tools',
      },
      scopes: ['read'],
    })
  })

  it('exposes fresh authorization details on HookfishError', async () => {
    const hookfish = new Hookfish({
      apiKey: 'broker-key',
      baseUrl: 'http://local/api',
      fetch: async () =>
        Response.json(
          {
            error: {
              code: 'authorization_required',
              message: 'Authorize this connection.',
              authorize_url: 'https://provider.test/authorize?state=fresh',
              expires_at: '2026-08-12T18:00:00.000Z',
            },
          },
          { status: 401 },
        ),
    })

    const error: unknown = await hookfish.connections
      .access('user/personal/gmail')
      .catch((value: unknown) => value)

    expect(error).toBeInstanceOf(HookfishError)
    expect(error).toMatchObject({
      code: 'authorization_required',
      status: 401,
      authorizeUrl: 'https://provider.test/authorize?state=fresh',
      expiresAt: '2026-08-12T18:00:00.000Z',
    })
  })

  it('propagates the Hookfish response through Hono', async () => {
    const hookfish = new Hookfish({
      apiKey: 'broker-key',
      baseUrl: 'http://local/api',
      fetch: async () =>
        Response.json(
          {
            error: {
              code: 'authorization_required',
              message: 'Authorize this connection.',
              authorize_url: 'https://provider.test/authorize?state=fresh',
            },
          },
          {
            status: 401,
            headers: { 'X-Hookfish-Test': 'preserved' },
          },
        ),
    })
    const app = new Hono().get('/connection', async (context) =>
      context.json(await hookfish.connections.access('user/personal/gmail')),
    )

    const response = await app.request('/connection')

    expect(response.status).toBe(401)
    expect(response.headers.get('X-Hookfish-Test')).toBe('preserved')
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'authorization_required',
        authorize_url: 'https://provider.test/authorize?state=fresh',
      },
    })
  })

  it('starts fresh authorization explicitly', async () => {
    const requests: Request[] = []
    const hookfish = new Hookfish({
      apiKey: 'broker-key',
      baseUrl: 'http://local/api',
      fetch: async (input, init) => {
        const request = new Request(input, init)
        requests.push(request)
        if (request.url.includes('/authorize/')) {
          return Response.json(
            {
              error: {
                code: 'authorization_required',
                message: 'Authorize this connection.',
                authorize_url: 'https://provider.test/authorize?state=fresh',
                expires_at: '2026-08-12T18:00:00.000Z',
              },
            },
            { status: 401 },
          )
        }
        return Response.json(access)
      },
    })

    const error: unknown = await hookfish.connections
      .authorize('user/personal/gmail/mcp', {
        configuration: { resource_url: 'https://gmail.run.tools' },
        scopes: [],
      })
      .catch((value: unknown) => value)

    expect(error).toMatchObject({
      name: 'HookfishError',
      code: 'authorization_required',
      status: 401,
    })
    expect(requests.map(({ url }) => url)).toEqual([
      'http://local/api/connections/authorize/user%2Fpersonal%2Fgmail%2Fmcp',
    ])
  })

  // Reads the response the way callers do. The runtime shape was always the
  // bare body, but the declared type used to describe a `{ data }` envelope,
  // so this destructuring failed to compile.
  it('resolves to the response body, as declared', async () => {
    const hookfish = new Hookfish({
      apiKey: 'broker-key',
      baseUrl: 'http://local/api',
      fetch: async () => Response.json(access),
    })

    const { secret, path } = await hookfish.connections.access(
      'user/personal/gmail',
    )
    const token: string = secret

    expect(token).toBe('gmail-token')
    expect(path).toBe('user/personal/gmail')
  })
})
