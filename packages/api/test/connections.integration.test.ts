import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parseConnectionPath } from '../src/oauth/resource-path'
import { createHarness, type TestHarness } from './harness'

const authorizationRequiredSchema = z.object({
  error: z.object({ code: z.string(), authorize_url: z.url() }),
})
const accessTokenSchema = z.object({ access_token: z.string() })

describe('connections', () => {
  let harness: TestHarness

  beforeEach(async () => {
    harness = await createHarness()
  })

  afterEach(async () => {
    await harness.close()
  })

  it('generates a fresh authorization URL on every unready access', async () => {
    const first = await harness.authorize()
    const second = await harness.authorize()

    expect(first.state).not.toBe(second.state)

    const superseded = await harness.fetch(
      `${new URL(first.callbackUrl).pathname}${new URL(first.callbackUrl).search}`,
    )
    expect(superseded.status).toBe(409)
    await expect(superseded.json()).resolves.toMatchObject({
      error: { code: 'authorization_superseded' },
    })

    const callback = await harness.fetch(
      `${new URL(second.callbackUrl).pathname}${new URL(second.callbackUrl).search}`,
    )
    expect(callback.status).toBe(200)

    const access = await harness.fetch(
      '/api/connections/access/user/personal/stub',
      { method: 'POST' },
    )
    expect(access.status).toBe(200)
    await expect(access.json()).resolves.toMatchObject({
      path: 'user/personal/stub',
      secret: expect.stringMatching(/^access-/),
      scopes: ['read', 'write'],
      refreshed: false,
    })

    const forced = await harness.fetch(
      '/api/connections/authorize/user/personal/stub',
      {
        method: 'POST',
      },
    )
    expect(forced.status).toBe(401)
    await expect(forced.json()).resolves.toMatchObject({
      error: { code: 'authorization_required' },
    })
  })

  it('distinguishes never-requested scopes from scopes the provider declined', async () => {
    const authorization = await harness.authorize()
    const callbackUrl = new URL(authorization.callbackUrl)
    const callback = await harness.fetch(
      `${callbackUrl.pathname}${callbackUrl.search}`,
    )
    expect(callback.status).toBe(200)

    const response = await harness.fetch(
      '/api/connections/access/user/personal/stub',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scopes: ['read', 'write', 'admin'] }),
      },
    )
    expect(response.status).toBe(401)
    const body = authorizationRequiredSchema.parse(await response.json())
    expect(body.error.code).toBe('authorization_required')
    expect(
      new URL(body.error.authorize_url).searchParams.get('scope')?.split(' '),
    ).toEqual(['read', 'write', 'admin'])

    const consent = await fetch(body.error.authorize_url, {
      redirect: 'manual',
    })
    const declinedCallbackUrl = consent.headers.get('location')
    if (!declinedCallbackUrl)
      throw new Error('Stub did not return a callback URL.')
    harness.stub.nextTokenResponse = {
      access_token: 'restricted-access',
      refresh_token: 'restricted-refresh',
      expires_in: 3600,
      scope: 'read write',
    }
    const declinedCallback = new URL(declinedCallbackUrl)
    const completion = await harness.fetch(
      `${declinedCallback.pathname}${declinedCallback.search}`,
    )
    expect(completion.status).toBe(200)

    await expect(
      harness.db.getConnection('user/personal', 'stub'),
    ).resolves.toMatchObject({
      requestedScopes: ['read', 'write', 'admin'],
      scopes: ['read', 'write'],
    })

    const declined = await harness.fetch(
      '/api/connections/access/user/personal/stub',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scopes: ['read', 'write', 'admin'] }),
      },
    )
    expect(declined.status).toBe(403)
    await expect(declined.json()).resolves.toMatchObject({
      error: {
        code: 'scope_not_granted',
        requested_scopes: ['read', 'write', 'admin'],
        granted_scopes: ['read', 'write'],
        missing_scopes: ['admin'],
      },
    })

    const permitted = await harness.fetch(
      '/api/connections/access/user/personal/stub',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scopes: ['read'] }),
      },
    )
    expect(permitted.status).toBe(200)

    const newScope = await harness.fetch(
      '/api/connections/access/user/personal/stub',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scopes: ['read', 'write', 'admin', 'calendar'],
        }),
      },
    )
    expect(newScope.status).toBe(401)
    await expect(newScope.json()).resolves.toMatchObject({
      error: { code: 'authorization_required' },
    })
  })

  it('stores and retrieves a static provider secret through the same access API', async () => {
    const missing = await harness.fetch(
      `/api/connections/access/${encodeURIComponent('service/prod/openai/secret')}`,
      { method: 'POST' },
    )
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({
      error: { code: 'secret_required' },
    })

    const stored = await harness.fetch(
      '/api/connections/secret/service/prod/openai/secret',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: 'sk-test' }),
      },
    )
    expect(stored.status).toBe(200)

    const access = await harness.fetch(
      '/api/connections/access/service/prod/openai/secret',
      { method: 'POST' },
    )
    expect(access.status).toBe(200)
    await expect(access.json()).resolves.toMatchObject({
      path: 'service/prod/openai/secret',
      secret: 'sk-test',
    })
  })

  it('stores a connection without a namespace', async () => {
    const stored = await harness.fetch('/api/connections/secret/secret', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: 'root-secret' }),
    })
    expect(stored.status).toBe(200)

    const access = await harness.fetch('/api/connections/access/secret', {
      method: 'POST',
    })
    expect(access.status).toBe(200)
    await expect(access.json()).resolves.toMatchObject({
      path: 'secret',
      secret: 'root-secret',
    })
  })

  it('returns a fresh authorization URL when refresh is rejected', async () => {
    const authorization = await harness.authorize()
    const callbackUrl = new URL(authorization.callbackUrl)
    const callback = await harness.fetch(
      `${callbackUrl.pathname}${callbackUrl.search}`,
    )
    expect(callback.status).toBe(200)

    const connection = await harness.db.getConnection('user/personal', 'stub')
    if (!connection) throw new Error('Connection was not stored.')
    await harness.db.updateConnection(connection.id, {
      expiresAt: new Date(Date.now() - 60_000),
    })
    harness.stub.nextTokenStatus = 400

    const response = await harness.fetch(
      '/api/connections/access/user/personal/stub',
      { method: 'POST' },
    )
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'authorization_required',
        authorize_url: expect.stringContaining('state='),
      },
    })
  })

  it('lists metadata without returning stored credentials', async () => {
    await harness.fetch('/api/connections/secret/team/openai/secret', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: 'never-list-me' }),
    })

    const response = await harness.fetch('/api/connections')
    const text = await response.text()
    expect(response.status).toBe(200)
    expect(text).not.toContain('never-list-me')
    expect(JSON.parse(text)).toMatchObject({
      connections: [{ path: 'team/openai/secret', provider_id: 'secret' }],
    })
  })

  it('treats a fixed provider and dynamic MCP path as different identities', () => {
    expect(parseConnectionPath('github')).toEqual({
      path: 'github',
      namespace: '',
      providerId: 'github',
    })
    expect(parseConnectionPath('user/personal/gmail')).toEqual({
      path: 'user/personal/gmail',
      namespace: 'user/personal',
      providerId: 'gmail',
    })
    expect(parseConnectionPath('user/personal/gmail/mcp')).toEqual({
      path: 'user/personal/gmail/mcp',
      namespace: 'user/personal/gmail',
      providerId: 'mcp',
    })
  })

  it('describes OAuth and secret provider inputs', async () => {
    const response = await harness.fetch('/api/connections/providers')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      providers: [
        {
          id: 'stub',
          label: 'Stub OAuth',
          authentication: 'oauth',
          input_schema: { fields: [] },
        },
        {
          id: 'mcp',
          label: 'Stub OAuth',
          authentication: 'oauth',
          input_schema: {
            fields: [
              {
                name: 'name',
                label: 'Resource name',
                type: 'text',
                target: 'identity',
                required: true,
              },
              {
                name: 'resource_url',
                label: 'MCP server URL',
                type: 'url',
                target: 'configuration',
                required: true,
              },
              {
                name: 'scopes',
                label: 'Scopes',
                type: 'string_list',
                target: 'scopes',
                required: false,
              },
            ],
          },
        },
        {
          id: 'secret',
          label: 'Static secret',
          authentication: 'secret',
          input_schema: {
            fields: [
              {
                name: 'name',
                label: 'Credential name',
                type: 'text',
                target: 'identity',
                required: true,
                placeholder: 'openai',
              },
            ],
          },
        },
      ],
    })
  })

  it('accepts empty provider configuration with requested scopes', async () => {
    const response = await harness.fetch(
      '/api/connections/access/user/personal/stub',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configuration: {}, scopes: ['read'] }),
      },
    )

    expect(response.status).toBe(401)
    await expect(
      harness.db.getConnection('user/personal', 'stub'),
    ).resolves.toMatchObject({ configuration: {} })
  })

  it('stores MCP configuration on the connection and rejects changes', async () => {
    const path = '/api/connections/access/user/personal/notion/mcp'
    const first = await harness.fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        configuration: { resource_url: 'https://mcp.example.com/one' },
        scopes: ['read'],
      }),
    })
    expect(first.status).toBe(401)

    const conflict = await harness.fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        configuration: { resource_url: 'https://mcp.example.com/two' },
        scopes: ['read'],
      }),
    })
    expect(conflict.status).toBe(409)
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: 'connection_configuration_conflict' },
    })
  })

  it('accepts provider configuration from metadata-driven clients', async () => {
    const response = await harness.fetch(
      '/api/connections/access/user/personal/slack/mcp',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          configuration: { resource_url: 'https://mcp.example.com/slack' },
          scopes: ['read'],
        }),
      },
    )

    expect(response.status).toBe(401)
    await expect(
      harness.db.getConnection('user/personal/slack', 'mcp'),
    ).resolves.toMatchObject({
      configuration: {
        resource_url: 'https://mcp.example.com/slack',
      },
    })
  })

  it('rejects provider IDs that are not JavaScript-variable friendly', async () => {
    const response = await harness.fetch(
      '/api/connections/access/user/personal/not-valid',
      { method: 'POST' },
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'invalid_provider_id' },
    })

    const reserved = await harness.fetch(
      '/api/connections/access/user/personal/class',
      { method: 'POST' },
    )
    expect(reserved.status).toBe(400)
  })

  it('isolates tenants through resource paths and scoped tokens', async () => {
    for (const [tenant, secret] of [
      ['acme', 'acme-secret'],
      ['beta', 'beta-secret'],
    ]) {
      const stored = await harness.fetch(
        `/api/connections/secret/organizations/${tenant}/team/service/secret`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret }),
        },
      )
      expect(stored.status).toBe(200)
    }

    for (const [tenant, secret] of [
      ['acme', 'acme-secret'],
      ['beta', 'beta-secret'],
    ]) {
      const access = await harness.fetch(
        `/api/connections/access/organizations/${tenant}/team/service/secret`,
        { method: 'POST' },
      )
      expect(access.status).toBe(200)
      await expect(access.json()).resolves.toMatchObject({ secret })
    }
    for (const path of [
      'team/allowed/secret',
      'team/allowed/nested/secret',
      'team/denied/secret',
    ]) {
      const stored = await harness.fetch(
        `/api/connections/secret/organizations/acme/${path}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret: path }),
        },
      )
      expect(stored.status).toBe(200)
    }

    const mint = async (name: string, scopes: string[]) => {
      const response = await harness.fetch('/api/admin/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, scopes }),
      })
      expect(response.status).toBe(200)
      return accessTokenSchema.parse(await response.json())
    }
    const exact = await mint('exact', [
      'organizations/acme/team/allowed/secret',
    ])
    const subtree = await mint('subtree', [
      'organizations/acme/team/allowed/**',
    ])
    const authorize = (token: string) => ({
      Authorization: `Bearer ${token}`,
    })

    const exactAccess = await harness.fetch(
      '/api/connections/access/organizations/acme/team/allowed/secret',
      { method: 'POST', headers: authorize(exact.access_token) },
    )
    expect(exactAccess.status).toBe(200)

    const exactDescendant = await harness.fetch(
      '/api/connections/access/organizations/acme/team/allowed/nested/secret',
      { method: 'POST', headers: authorize(exact.access_token) },
    )
    expect(exactDescendant.status).toBe(403)
    await expect(exactDescendant.json()).resolves.toMatchObject({
      error: { code: 'insufficient_scope' },
    })

    const subtreeAccess = await harness.fetch(
      '/api/connections/access/organizations/acme/team/allowed/nested/secret',
      { method: 'POST', headers: authorize(subtree.access_token) },
    )
    expect(subtreeAccess.status).toBe(200)

    const denied = await harness.fetch(
      '/api/connections/access/organizations/acme/team/denied/secret',
      { method: 'POST', headers: authorize(subtree.access_token) },
    )
    expect(denied.status).toBe(403)

    const crossTenant = await harness.fetch(
      '/api/connections/access/organizations/beta/team/service/secret',
      { method: 'POST', headers: authorize(subtree.access_token) },
    )
    expect(crossTenant.status).toBe(403)

    const list = await harness.fetch('/api/connections', {
      headers: authorize(subtree.access_token),
    })
    expect(list.status).toBe(200)
    await expect(list.json()).resolves.toMatchObject({
      connections: [
        { path: 'organizations/acme/team/allowed/secret' },
        { path: 'organizations/acme/team/allowed/nested/secret' },
      ],
    })
  })
})
