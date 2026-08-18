import { Client as McpClient } from '@modelcontextprotocol/client'
import { Hono } from 'hono'
import { Octokit } from 'octokit'
import { describe, expect, it, vi } from 'vitest'
import packageJson from '../package.json'
import { Hookfish, HookfishError } from '../src'

const access = {
  path: 'user/personal/gmail',
  secret: 'gmail-token',
  scopes: [],
  expires_at: null,
  refreshed: false,
}

function mockMcpServer() {
  const messages: Array<Record<string, unknown>> = []
  const fetcher = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init)
      if (request.method === 'DELETE')
        return new Response(null, { status: 204 })

      const payload: unknown = await request.json()
      if (typeof payload !== 'object' || payload === null) {
        throw new Error('Expected an MCP JSON-RPC object.')
      }
      const message = Object.fromEntries(Object.entries(payload))
      messages.push(message)

      if (message.method === 'server/discover') {
        return Response.json({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: 'Method not found' },
        })
      }
      if (message.method === 'initialize') {
        return Response.json({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            serverInfo: { name: 'test-server', version: '1.0.0' },
          },
        })
      }
      if (message.method === 'notifications/initialized') {
        return new Response(null, { status: 202 })
      }

      throw new Error(`Unexpected MCP request: ${String(message.method)}`)
    },
  )

  return { fetcher, messages }
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

  it('creates and connects a default MCP client', async () => {
    const server = mockMcpServer()
    vi.stubGlobal('fetch', server.fetcher)
    const hookfish = new Hookfish({
      apiKey: 'broker-key',
      baseUrl: 'http://local/api',
      fetch: async () => Response.json(access),
    })

    const mcp = await hookfish.mcp({
      connection: 'user/personal/gmail/mcp',
      url: 'https://gmail.run.tools',
    })

    try {
      const initialize = server.messages.find(
        ({ method }) => method === 'initialize',
      )
      expect(initialize).toMatchObject({
        params: {
          clientInfo: {
            name: '@hookfish/sdk',
            version: packageJson.version,
          },
        },
      })
    } finally {
      await mcp.close()
      vi.unstubAllGlobals()
    }
  })

  it('returns an authenticated Octokit client for GitHub', async () => {
    let githubRequest: Request | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        githubRequest = new Request(input, init)
        return Response.json({ login: 'octocat' })
      }),
    )
    const hookfish = new Hookfish({
      apiKey: 'broker-key',
      baseUrl: 'http://local/api',
      fetch: async () =>
        Response.json({
          ...access,
          path: 'user/personal/github',
          secret: 'github-token',
        }),
    })

    try {
      const github = await hookfish.github('user/personal/github')
      expect(github).toBeInstanceOf(Octokit)
      await expect(github.rest.users.getAuthenticated()).resolves.toMatchObject(
        {
          data: { login: 'octocat' },
        },
      )
      expect(githubRequest?.headers.get('authorization')).toContain(
        'github-token',
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('connects and returns a caller-provided MCP client', async () => {
    const server = mockMcpServer()
    vi.stubGlobal('fetch', server.fetcher)
    const custom = new McpClient(
      { name: 'custom-client', version: '2.3.4' },
      { versionNegotiation: { mode: 'auto' } },
    )
    const close = vi.spyOn(custom, 'close')
    const hookfish = new Hookfish({
      apiKey: 'broker-key',
      baseUrl: 'http://local/api',
      fetch: async () => Response.json(access),
    })

    try {
      {
        await using mcp = await hookfish.provider.mcp({
          connection: 'user/personal/gmail/mcp',
          url: new URL('https://gmail.run.tools'),
          client: custom,
        })

        expect(mcp).toBe(custom)
        const initialize = server.messages.find(
          ({ method }) => method === 'initialize',
        )
        expect(initialize).toMatchObject({
          params: {
            clientInfo: { name: 'custom-client', version: '2.3.4' },
          },
        })
      }
      expect(close).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('starts fresh authorization after an upstream MCP 401', async () => {
    const brokerRequests: Request[] = []
    vi.stubGlobal('fetch', async () => new Response(null, { status: 401 }))
    const hookfish = new Hookfish({
      apiKey: 'broker-key',
      baseUrl: 'http://local/api',
      fetch: async (input, init) => {
        const request = new Request(input, init)
        brokerRequests.push(request)
        if (request.url.includes('/authorize/')) {
          return Response.json(
            {
              error: {
                code: 'authorization_required',
                message: 'Authorize this connection.',
                authorize_url: 'https://provider.test/authorize?state=fresh',
              },
            },
            { status: 401 },
          )
        }
        return Response.json(access)
      },
    })

    try {
      await expect(
        hookfish.provider.mcp({
          connection: 'user/personal/gmail/mcp',
          url: 'https://gmail.run.tools',
        }),
      ).rejects.toMatchObject({
        name: 'HookfishError',
        code: 'authorization_required',
        authorizeUrl: 'https://provider.test/authorize?state=fresh',
      })
      expect(brokerRequests.map(({ url }) => url)).toEqual([
        'http://local/api/connections/access/user%2Fpersonal%2Fgmail%2Fmcp',
        'http://local/api/connections/authorize/user%2Fpersonal%2Fgmail%2Fmcp',
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
