import { env } from 'cloudflare:test'
import { Hookfish } from '@hookfish/api'
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
      connectionId: 'connection',
      provider: 'github',
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
      connectionId: 'connection',
      status: 'processing',
      expiresAt,
    })
  })

  it('does not let another provider take a connection id', async () => {
    const db = database('connection-ownership')
    const connection = {
      organization: null,
      connectionId: 'shared/connection',
      provider: 'github',
      accessToken: 'encrypted-access',
      refreshToken: null,
      tokenType: 'Bearer',
      scopes: ['repo'],
      expiresAt: null,
      metadata: {},
      externalAccountId: null,
      externalAccountLabel: null,
    }

    expect(await db.upsertOAuthConnection(connection)).toMatchObject({
      provider: 'github',
    })
    expect(
      await db.upsertOAuthConnection({ ...connection, provider: 'linear' }),
    ).toBeUndefined()
    expect(await db.getOAuthConnection('shared/connection')).toMatchObject({
      provider: 'github',
    })
  })

  it('isolates named database partitions', async () => {
    const acme = database('organization:acme')
    const globex = database('organization:globex')

    await acme.putVaultSecret({
      organization: 'acme',
      path: 'acme/provider/client-secret',
      value: 'encrypted',
    })

    expect(
      await acme.getVaultSecret('acme', 'acme/provider/client-secret'),
    ).toMatchObject({ value: 'encrypted' })
    expect(
      await globex.getVaultSecret('acme', 'acme/provider/client-secret'),
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

  it('uses the global partition to authorize organization requests', async () => {
    const db = durableObjects<Env>((bindings, context) =>
      bindings.HOOKFISH_DB.getByName(
        `auth-routing:${context.organization ?? '__global__'}`,
      ),
    )
    const hookfish = await Hookfish.init<Env>({
      db,
      providers: {},
      organizationRouting: true,
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
      body: JSON.stringify({ name: 'acme-worker', scopes: ['acme'] }),
    })
    expect(mintedResponse.status).toBe(200)
    const minted: { access_token: string } = await mintedResponse.json()

    const organizationResponse = await request(
      '/api/organization/acme/oauth/connections',
      minted.access_token,
    )
    expect(organizationResponse.status).toBe(200)
    expect(await organizationResponse.json()).toEqual({ connections: [] })
  })
})
