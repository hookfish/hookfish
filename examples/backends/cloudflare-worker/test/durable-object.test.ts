import { env } from 'cloudflare:test'
import { HookfishServer } from '@hookfish/api'
import { durableObjects } from '@hookfish/database/durable-object'
import { describe, expect, it } from 'vitest'

function database(name: string) {
  return env.HOOKFISH_DB.getByName(name)
}

describe('HookfishDurableObject', () => {
  it('atomically claims an OAuth state once', async () => {
    const db = database('state-claim')
    const expiresAt = new Date(Date.now() + 60_000)
    await db.createOAuthState({
      id: 'state-hash',
      namespace: 'user/personal',
      providerId: 'github',
      redirectUri: 'https://example.com/callback',
      scopes: ['repo'],
      expiresAt,
    })

    const claims = await Promise.all([
      db.claimOAuthState(['state-hash'], 'github'),
      db.claimOAuthState(['state-hash'], 'github'),
    ])

    expect(claims.filter(Boolean)).toHaveLength(1)
    expect(await db.getOAuthState(['state-hash'], 'github')).toMatchObject({
      namespace: 'user/personal',
      providerId: 'github',
      status: 'processing',
      expiresAt,
    })
  })

  it('uniquely identifies a connection by namespace and provider', async () => {
    const db = database('connection-ownership')
    const connection = {
      namespace: 'shared',
      providerId: 'github',
      configuration: {},
      secret: 'encrypted-access',
      requestedScopes: ['repo'],
      scopes: ['repo'],
    }

    expect(await db.putConnection(connection)).toMatchObject({
      providerId: 'github',
    })
    expect(await db.putConnection(connection)).toMatchObject({
      providerId: 'github',
    })
    expect(await db.getConnection('shared', 'github')).toMatchObject({
      providerId: 'github',
      requestedScopes: ['repo'],
      scopes: ['repo'],
    })
  })

  it('isolates named database partitions', async () => {
    const acme = database('tenant:acme')
    const globex = database('tenant:globex')

    await acme.putVaultSecret({
      path: 'organizations/acme/provider/client-secret',
      value: 'encrypted',
    })

    expect(
      await acme.getVaultSecret('organizations/acme/provider/client-secret'),
    ).toMatchObject({ value: 'encrypted' })
    expect(
      await globex.getVaultSecret('organizations/acme/provider/client-secret'),
    ).toBeUndefined()
  })

  it('enforces unique active broker token names', async () => {
    const db = database('broker-tokens')
    const token = {
      name: 'worker',
      tokenIdHash: 'hash',
      scopes: ['team/**'],
      expiresAt: new Date(Date.now() + 60_000),
    }

    expect(await db.createBrokerAccessToken(token)).toBe(true)
    expect(await db.createBrokerAccessToken(token)).toBe(false)
    expect(await db.listBrokerAccessTokenNames()).toEqual(['worker'])
  })

  it('uses the configured partition for broker requests', async () => {
    const db = durableObjects<Env>((bindings) =>
      bindings.HOOKFISH_DB.getByName('broker'),
    )
    const hookfish = await HookfishServer.init<Env>({
      db,
      providers: {},
    })
    const request = (path: string, token: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers)
      headers.set('Authorization', `Bearer ${token}`)
      return hookfish.fetch(
        new Request(`https://example.com${path}`, { ...init, headers }),
        env,
      )
    }

    const mintedResponse = await request('/api/admin/tokens', 'test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'acme-worker', scopes: ['acme/**'] }),
    })
    expect(mintedResponse.status).toBe(200)
    const minted: { access_token: string } = await mintedResponse.json()

    const connectionsResponse = await request(
      '/api/connections',
      minted.access_token,
    )
    expect(connectionsResponse.status).toBe(200)
    expect(await connectionsResponse.json()).toEqual({ connections: [] })
  })
})
