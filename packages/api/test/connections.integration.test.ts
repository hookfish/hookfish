import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseConnectionPath } from '../src/oauth/resource-path'
import { createHarness, type TestHarness } from './harness'

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
      '/api/connections/reauthorize/user/personal/stub',
      {
        method: 'POST',
      },
    )
    expect(forced.status).toBe(401)
    await expect(forced.json()).resolves.toMatchObject({
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

  it('returns a fresh authorization URL when refresh is rejected', async () => {
    const authorization = await harness.authorize()
    const callbackUrl = new URL(authorization.callbackUrl)
    const callback = await harness.fetch(
      `${callbackUrl.pathname}${callbackUrl.search}`,
    )
    expect(callback.status).toBe(200)

    const connection = await harness.db.getConnection(
      '',
      'user/personal',
      'stub',
    )
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

  it('stores MCP configuration on the connection and rejects changes', async () => {
    const path = '/api/connections/access/user/personal/notion/mcp'
    const first = await harness.fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://mcp.example.com/one', scopes: [] }),
    })
    expect(first.status).toBe(401)

    const conflict = await harness.fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://mcp.example.com/two', scopes: [] }),
    })
    expect(conflict.status).toBe(409)
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: 'connection_configuration_conflict' },
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
})
