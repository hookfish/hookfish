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

  it('selects organization-prefixed operations', async () => {
    let request: Request | undefined
    const hookfish = new Hookfish({
      apiKey: 'broker-key',
      baseUrl: 'http://local/api',
      organization: 'acme',
      fetch: async (input, init) => {
        request = new Request(input, init)
        return Response.json(access)
      },
    })

    await hookfish.connections.access('user/personal/gmail')

    expect(request?.url).toBe(
      'http://local/api/organization/acme/connections/access/user%2Fpersonal%2Fgmail',
    )
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
        url: 'https://gmail.run.tools',
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
})
