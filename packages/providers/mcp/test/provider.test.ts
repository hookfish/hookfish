import { createProviderRegistry } from '@hookfish/provider'
import { describe, expect, it, vi } from 'vitest'
import { McpProvider } from '../src'

const resourceUrl = 'https://mcp.example.com/team/mcp'
const resourceMetadataUrl =
  'https://mcp.example.com/.well-known/oauth-protected-resource/team/mcp'
const issuer = 'https://auth.example.com/tenant'
const authorizationMetadataUrl =
  'https://auth.example.com/.well-known/oauth-authorization-server/tenant'

function discoveryResponse(input: string | URL | Request) {
  const url = String(input)
  if (url === resourceUrl) {
    return new Response(null, {
      status: 401,
      headers: {
        'WWW-Authenticate': `Bearer resource_metadata="${resourceMetadataUrl}", scope="tools:read resources:read"`,
      },
    })
  }
  if (url === resourceMetadataUrl) {
    return Response.json({
      resource: resourceUrl,
      authorization_servers: [issuer],
      scopes_supported: ['fallback'],
    })
  }
  if (url === authorizationMetadataUrl) {
    return Response.json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      registration_endpoint: `${issuer}/register`,
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    })
  }
  return new Response('not found', { status: 404 })
}

describe('McpProvider', () => {
  it('acquires credentials with OAuth', () => {
    expect(new McpProvider().authentication).toBe('oauth')
  })

  it('is configured as a connection-configured registry provider', () => {
    const registry = createProviderRegistry({ mcp: new McpProvider() })

    expect(registry.isProviderConfigured('mcp')).toBe(true)
  })

  it('discovers MCP OAuth metadata, registers, and uses PKCE and resource indicators', async () => {
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        if (url === `${issuer}/register`) {
          expect(JSON.parse(String(init?.body))).toMatchObject({
            redirect_uris: [
              'https://broker.example/api/connections/callback/mcp',
            ],
            token_endpoint_auth_method: 'none',
            application_type: 'web',
          })
          return Response.json({ client_id: 'registered-client' })
        }
        if (url === `${issuer}/token`) {
          const body = new URLSearchParams(String(init?.body))
          expect(Object.fromEntries(body)).toMatchObject({
            grant_type: 'authorization_code',
            code: 'authorization-code',
            client_id: 'registered-client',
            resource: resourceUrl,
          })
          expect(body.get('code_verifier')).toBeTruthy()
          return Response.json({
            access_token: 'mcp-token',
            refresh_token: 'mcp-refresh',
            expires_in: 3600,
          })
        }
        return discoveryResponse(input)
      },
    )

    const template = new McpProvider({ fetch: fetcher })
    const configuration = template.normalizeConfiguration({
      resource_url: resourceUrl,
    })
    const credentials = await template.registerClient({
      configuration,
      redirectUri: 'https://broker.example/api/connections/callback/mcp',
      clientMetadataUrl:
        'https://broker.example/api/connections/client-metadata.json',
    })
    expect(credentials).toEqual({
      clientId: 'registered-client',
      issuer,
    })

    const provider = template.createProvider(
      { clientId: credentials.clientId, clientSecret: '' },
      configuration,
    )
    const authorization = await provider.createAuthorization({
      redirectUri: 'https://broker.example/api/connections/callback/mcp',
      state: 'state-value',
      scopes: [],
    })
    const authorizeUrl = new URL(authorization.url)
    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe(
      `${issuer}/authorize`,
    )
    expect(Object.fromEntries(authorizeUrl.searchParams)).toMatchObject({
      client_id: 'registered-client',
      state: 'state-value',
      code_challenge_method: 'S256',
      resource: resourceUrl,
      scope: 'tools:read resources:read',
    })
    expect(authorization.codeVerifier).toBeTruthy()

    const result = await provider.exchangeCode({
      code: 'authorization-code',
      redirectUri: 'https://broker.example/api/connections/callback/mcp',
      codeVerifier: authorization.codeVerifier,
      issuer,
    })
    expect(result.payload.access_token).toBe('mcp-token')
  })

  it('rejects an authorization callback from a different issuer', async () => {
    const provider = new McpProvider({
      resourceUrl,
      clientId: 'client',
      fetch: async (input) => discoveryResponse(input),
    })

    await expect(
      provider.exchangeCode({
        code: 'code',
        redirectUri: 'https://broker.example/api/connections/callback/mcp',
        issuer: 'https://attacker.example.com',
      }),
    ).rejects.toThrow('does not match')
  })

  it('reports OAuth token errors with their status and identifier', async () => {
    const provider = new McpProvider({
      resourceUrl,
      clientId: 'client',
      fetch: async (input) => {
        if (String(input) === `${issuer}/token`) {
          return Response.json({ error: 'invalid_grant' }, { status: 400 })
        }
        return discoveryResponse(input)
      },
    })

    await expect(
      provider.refreshToken({ refreshToken: 'rejected-refresh-token' }),
    ).rejects.toMatchObject({
      status: 400,
      oauthError: 'invalid_grant',
    })
  })

  it('prefers an OAuth client metadata document when the server supports it', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (String(input) === authorizationMetadataUrl) {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          registration_endpoint: `${issuer}/register`,
          client_id_metadata_document_supported: true,
          code_challenge_methods_supported: ['S256'],
        })
      }
      return discoveryResponse(input)
    })
    const provider = new McpProvider({ fetch: fetcher })
    const credentials = await provider.registerClient({
      configuration: { resource_url: resourceUrl },
      redirectUri: 'https://broker.example/api/connections/callback/mcp',
      clientMetadataUrl:
        'https://broker.example/api/connections/client-metadata.json',
    })

    expect(credentials).toEqual({
      clientId: 'https://broker.example/api/connections/client-metadata.json',
      issuer,
    })
    expect(fetcher).not.toHaveBeenCalledWith(
      `${issuer}/register`,
      expect.anything(),
    )
  })

  it('uses dynamic registration when client metadata would be on localhost', async () => {
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        if (url === authorizationMetadataUrl) {
          return Response.json({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            registration_endpoint: `${issuer}/register`,
            client_id_metadata_document_supported: true,
            code_challenge_methods_supported: ['S256'],
          })
        }
        if (url === `${issuer}/register`) {
          expect(JSON.parse(String(init?.body))).toMatchObject({
            redirect_uris: [
              'https://inspector.localhost/api/connections/callback/mcp',
            ],
          })
          return Response.json({ client_id: 'localhost-registered-client' })
        }
        return discoveryResponse(input)
      },
    )
    const provider = new McpProvider({ fetch: fetcher })
    const credentials = await provider.registerClient({
      configuration: { resource_url: resourceUrl },
      redirectUri: 'https://inspector.localhost/api/connections/callback/mcp',
      clientMetadataUrl:
        'https://inspector.localhost/api/connections/client-metadata.json',
    })

    expect(credentials).toEqual({
      clientId: 'localhost-registered-client',
      issuer,
    })
  })
})
