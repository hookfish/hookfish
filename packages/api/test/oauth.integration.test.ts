import {
  type OAuthProvider,
  ProviderConfigurationError,
} from '@template/provider'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { oauthConnections, oauthStates } from '../src/db/schema'
import { purgeExpiredStates } from '../src/oauth/broker'
import {
  API_ORIGIN,
  createHarness,
  OTHER_ENCRYPTION_KEY,
  TEST_ENCRYPTION_KEY,
  type TestHarness,
} from './harness'

describe('OAuth broker integration', () => {
  let h: TestHarness

  beforeAll(async () => {
    h = await createHarness()
  })

  afterAll(async () => {
    await h.close()
  })

  it('lists the registered stub providers when credentials are set', async () => {
    const res = await h.fetch('/api/oauth/providers')
    expect(res.status).toBe(200)

    const body: {
      providers: Array<{
        id: string
        configured: boolean
        callback_url: string
        scopes: string[]
        available_scopes: string[]
      }>
    } = await res.json()

    const stub = body.providers.find((p) => p.id === h.providerId)
    expect(stub).toMatchObject({
      configured: true,
      callback_url: `http://127.0.0.1:8787/api/oauth/${h.providerId}/callback`,
      scopes: ['read', 'write'],
      available_scopes: ['read', 'write'],
    })
  })

  it('ships GitHub with its selectable scopes and does not ship Google', () => {
    const github = h.providers.getProvider('github')

    expect(github).toMatchObject({
      defaultScopes: [],
      usesPkce: false,
    })
    expect(github?.refreshToken).toBeUndefined()
    expect(github?.availableScopes).toContain('repo')
    expect(github?.availableScopes).toContain('read:user')
    expect(h.providers.listProviderIds()).not.toContain('google')
  })

  it('keeps provider-specific authorization details inside providers', async () => {
    const common = {
      redirectUri: 'https://broker.example/callback',
      state: 'state',
    }
    const linear = h.providers.getProvider('linear')
    const github = h.providers.getProvider('github')
    const notion = h.providers.getProvider('notion')

    if (!linear || !github || !notion) {
      throw new Error('Expected built-in providers to be registered')
    }

    const linearUrl = new URL(
      (
        await linear.createAuthorization({
          ...common,
          scopes: ['read', 'write'],
        })
      ).url,
    )
    const githubUrl = new URL(
      (
        await github.createAuthorization({
          ...common,
          scopes: ['repo', 'gist'],
        })
      ).url,
    )
    const notionUrl = new URL(
      (await notion.createAuthorization({ ...common, scopes: [] })).url,
    )

    expect(linearUrl.searchParams.get('scope')).toBe('read,write')
    // Octokit owns GitHub's wire format; callers only pass a scope array.
    expect(githubUrl.searchParams.get('scope')).toBe('repo,gist')
    expect(notionUrl.searchParams.has('scope')).toBe(false)
    expect(notionUrl.searchParams.get('owner')).toBe('user')
  })

  it('serves /api/stats', async () => {
    const res = await h.fetch('/api/stats')
    expect(res.status).toBe(200)
    const body: { region: string; features: string[] } = await res.json()
    expect(body.region).toBe('local')
    expect(body.features.length).toBeGreaterThan(0)
  })

  it('runs authorize → callback → token → delete against a real stub + PGlite', async () => {
    const { connectionId, callback } = await h.authorizeAndCallback()

    expect(callback.status).toBe(200)
    const connected: {
      connected: true
      connection: {
        connection_id: string
        provider: string
        external_account_id: string | null
        external_account_label: string | null
      }
    } = await callback.json()

    expect(connected.connected).toBe(true)
    expect(connected.connection.connection_id).toBe(connectionId)
    expect(connected.connection.provider).toBe(h.providerId)
    expect(connected.connection.external_account_id).toBe('acct_stub')
    expect(connected.connection.external_account_label).toBe('Stub Account')

    const getRes = await h.fetch(`/api/oauth/connections/${connectionId}`)
    expect(getRes.status).toBe(200)
    const got: { connection: { connection_id: string } } = await getRes.json()
    expect(got.connection.connection_id).toBe(connectionId)

    const tokenRes = await h.fetch(
      `/api/oauth/connections/${connectionId}/token`,
    )
    expect(tokenRes.status).toBe(200)
    const token: {
      access_token: string
      refreshed: boolean
      provider: string
    } = await tokenRes.json()
    expect(token.access_token).toMatch(/^access-/)
    expect(token.refreshed).toBe(false)
    expect(token.provider).toBe(h.providerId)

    // Encrypted at rest — listing never returns token columns.
    const listText = await (await h.fetch('/api/oauth/connections')).text()
    expect(listText).not.toContain(token.access_token)

    const delRes = await h.fetch(`/api/oauth/connections/${connectionId}`, {
      method: 'DELETE',
    })
    expect(delRes.status).toBe(200)
    expect(await delRes.json()).toEqual({ deleted: true })

    const missing = await h.fetch(`/api/oauth/connections/${connectionId}`)
    expect(missing.status).toBe(404)
  })

  it('upserts when reconnecting the same connection id for the same provider', async () => {
    const connectionId = 'same-link-reconnect'
    h.stub.nextTokenResponse = {
      access_token: 'access-first',
      refresh_token: 'refresh-first',
      expires_in: 3600,
      account_id: 'acct_1',
    }

    const first = await h.authorizeAndCallback({ connectionId })
    expect(first.callback.status).toBe(200)

    h.stub.nextTokenResponse = {
      access_token: 'access-second',
      refresh_token: 'refresh-second',
      expires_in: 3600,
      account_id: 'acct_2',
    }

    const second = await h.authorizeAndCallback({ connectionId })
    expect(second.callback.status).toBe(200)

    const tokenRes = await h.fetch(
      `/api/oauth/connections/${connectionId}/token`,
    )
    const token: { access_token: string } = await tokenRes.json()
    expect(token.access_token).toBe('access-second')

    const listRes = await h.fetch(
      `/api/oauth/connections?provider=${h.providerId}`,
    )
    const list: { connections: Array<{ connection_id: string }> } =
      await listRes.json()
    const matches = list.connections.filter(
      (c) => c.connection_id === connectionId,
    )
    expect(matches).toHaveLength(1)

    await h.fetch(`/api/oauth/connections/${connectionId}`, {
      method: 'DELETE',
    })
  })

  it('returns 409 when the same connection id is used for a different provider', async () => {
    const connectionId = 'one-id-one-provider'

    const first = await h.authorizeAndCallback({ connectionId })
    expect(first.callback.status).toBe(200)

    const conflict = await h.fetch(`/api/oauth/${h.altProviderId}/authorize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connection_id: connectionId }),
    })

    expect(conflict.status).toBe(409)
    const body: { error: { code: string; message: string } } =
      await conflict.json()
    expect(body.error.code).toBe('connection_id_in_use')
    expect(body.error.message).toContain(h.providerId)

    await h.fetch(`/api/oauth/connections/${connectionId}`, {
      method: 'DELETE',
    })
  })

  it('rejects a replayed callback state', async () => {
    const { connectionId, callback } = await h.authorizeAndCallback()
    expect(callback.status).toBe(200)

    const authorizeRes = await h.fetch(`/api/oauth/${h.providerId}/authorize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connection_id: `${connectionId}-replay` }),
    })
    const authorizeJson: {
      authorize_url: string
      state: string
    } = await authorizeRes.json()

    const consentRes = await fetch(authorizeJson.authorize_url, {
      redirect: 'manual',
    })
    const location = consentRes.headers.get('location')
    expect(location).toBeTruthy()
    const callbackPath = new URL(location!).pathname + new URL(location!).search

    const firstCallback = await h.fetch(callbackPath)
    expect(firstCallback.status).toBe(200)

    const replay = await h.fetch(callbackPath)
    expect(replay.status).toBe(400)
    const body: { error: { code: string } } = await replay.json()
    expect(body.error.code).toBe('invalid_state')

    await h.fetch(`/api/oauth/connections/${connectionId}`, {
      method: 'DELETE',
    })
    await h.fetch(`/api/oauth/connections/${connectionId}-replay`, {
      method: 'DELETE',
    })
  })

  it('refreshes an expired access token via the stub', async () => {
    h.stub.nextTokenResponse = {
      access_token: 'access-expiring',
      refresh_token: 'refresh-keep',
      expires_in: 1,
      account_id: 'acct_refresh',
    }

    const { connectionId, callback } = await h.authorizeAndCallback({
      connectionId: 'needs-refresh',
    })
    expect(callback.status).toBe(200)

    await h.db
      .update(oauthConnections)
      .set({ expiresAt: new Date(Date.now() - 120_000) })
      .where(eq(oauthConnections.connectionId, connectionId))

    h.stub.nextTokenResponse = {
      access_token: 'access-refreshed',
      expires_in: 3600,
    }

    const tokenRes = await h.fetch(
      `/api/oauth/connections/${connectionId}/token`,
    )
    expect(tokenRes.status).toBe(200)
    const token: { access_token: string; refreshed: boolean } =
      await tokenRes.json()
    expect(token.refreshed).toBe(true)
    expect(token.access_token).toBe('access-refreshed')

    const refreshCalls = h.stub.tokenRequests.filter(
      (r) => r.grantType === 'refresh_token',
    )
    expect(refreshCalls.length).toBeGreaterThanOrEqual(1)
    expect(refreshCalls.at(-1)?.body.refresh_token).toBe('refresh-keep')

    await h.fetch(`/api/oauth/connections/${connectionId}`, {
      method: 'DELETE',
    })
  })

  it('rejects requests without a valid API key', async () => {
    const res = await h.fetch('/api/oauth/providers', {
      headers: { Authorization: 'Bearer wrong' },
    })
    expect(res.status).toBe(401)
  })

  it('returns 502 when the provider token endpoint fails', async () => {
    const authorizeRes = await h.fetch(`/api/oauth/${h.providerId}/authorize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connection_id: 'token-fail' }),
    })
    const authorizeJson: { authorize_url: string } = await authorizeRes.json()

    const consentRes = await fetch(authorizeJson.authorize_url, {
      redirect: 'manual',
    })
    const location = consentRes.headers.get('location')
    expect(location).toBeTruthy()

    h.stub.nextTokenStatus = 500

    const callback = await h.fetch(
      new URL(location!).pathname + new URL(location!).search,
    )
    expect(callback.status).toBe(502)
    const body: { error: { code: string } } = await callback.json()
    expect(body.error.code).toBe('token_exchange_failed')
  })

  it('redirects to return_to after a successful callback', async () => {
    const { callback } = await h.authorizeAndCallback({
      connectionId: 'with-return-to',
      returnTo: 'https://frontend.localhost/settings',
    })

    expect(callback.status).toBe(302)
    expect(callback.headers.get('location')).toBe(
      `https://frontend.localhost/settings?connected=${h.providerId}`,
    )

    await h.fetch('/api/oauth/connections/with-return-to', { method: 'DELETE' })
  })

  it('returns provider denial and invalid callback errors', async () => {
    const denied = await h.fetch(
      `/api/oauth/${h.providerId}/callback?error=access_denied&error_description=nope`,
    )
    expect(denied.status).toBe(400)
    expect(await denied.json()).toEqual({
      error: { code: 'access_denied', message: 'nope' },
    })

    const deniedDefault = await h.fetch(
      `/api/oauth/${h.providerId}/callback?error=access_denied`,
    )
    expect(deniedDefault.status).toBe(400)
    const deniedBody: { error: { message: string } } =
      await deniedDefault.json()
    expect(deniedBody.error.message).toContain('denied')

    const missing = await h.fetch(`/api/oauth/${h.providerId}/callback`)
    expect(missing.status).toBe(400)
    const missingBody: { error: { code: string } } = await missing.json()
    expect(missingBody.error.code).toBe('invalid_callback')
  })

  it('rejects unknown providers and missing credentials', async () => {
    const unknown = await h.fetch('/api/oauth/not-a-provider/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(unknown.status).toBe(404)
    const unknownBody: { error: { code: string } } = await unknown.json()
    expect(unknownBody.error.code).toBe('unknown_provider')

    const unconfiguredSlug = 'unconfigured'
    h.providers.register({
      [unconfiguredSlug]: {
        label: 'Unconfigured',
        defaultScopes: [],
        availableScopes: [],
        usesPkce: false,
        isConfigured: () => false,
        createAuthorization: () => {
          throw new ProviderConfigurationError('Missing provider credentials.')
        },
        exchangeCode: async () => ({ payload: {} }),
      },
    })
    const missingCreds = await h.fetch(
      `/api/oauth/${unconfiguredSlug}/authorize`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    )
    h.providers.unregister(unconfiguredSlug)

    expect(missingCreds.status).toBe(500)
    const credsBody: { error: { code: string } } = await missingCreds.json()
    expect(credsBody.error.code).toBe('missing_configuration')
  })

  it('applies STUB_SCOPES env overrides on authorize', async () => {
    h.env.STUB_SCOPES = 'alpha, beta'
    const res = await h.fetch(`/api/oauth/${h.providerId}/authorize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connection_id: 'scope-override' }),
    })
    h.env.STUB_SCOPES = undefined

    expect(res.status).toBe(200)
    const body: { authorize_url: string } = await res.json()
    const url = new URL(body.authorize_url)
    expect(url.searchParams.get('scope')).toBe('alpha beta')
  })

  it('parses comma-delimited token scopes for space-delimited providers', async () => {
    h.stub.nextTokenResponse = {
      access_token: 'access-comma-scopes',
      scope: 'repo,gist',
    }

    const { connectionId, callback } = await h.authorizeAndCallback({
      connectionId: 'comma-token-scopes',
      scopes: ['repo', 'gist'],
    })
    expect(callback.status).toBe(200)

    const tokenRes = await h.fetch(
      `/api/oauth/connections/${connectionId}/token`,
    )
    const token: { scopes: string[] } = await tokenRes.json()
    expect(token.scopes).toEqual(['repo', 'gist'])

    await h.fetch(`/api/oauth/connections/${connectionId}`, {
      method: 'DELETE',
    })
  })

  it('exercises PKCE, Basic auth, JSON token body, and authorizeParams', async () => {
    const before = h.stub.tokenRequests.length
    const { authorizeUrl, callback, connectionId } =
      await h.authorizeAndCallback({
        provider: h.dialectProviderId,
        connectionId: 'dialect-flow',
      })

    expect(callback.status).toBe(200)

    const authorize = new URL(authorizeUrl)
    expect(authorize.searchParams.get('code_challenge')).toBeTruthy()
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorize.searchParams.get('access_type')).toBe('offline')
    expect(authorize.searchParams.get('prompt')).toBe('consent')
    expect(authorize.searchParams.get('scope')).toBe('read,write')

    const tokenCall = h.stub.tokenRequests.slice(before).at(-1)
    expect(tokenCall?.authorization).toMatch(/^Basic /)
    expect(tokenCall?.contentType).toContain('application/json')
    expect(tokenCall?.body.code_verifier).toBeTruthy()

    await h.fetch(`/api/oauth/connections/${connectionId}`, {
      method: 'DELETE',
    })
  })

  it('omits scope when the provider has no default scopes', async () => {
    const { authorizeUrl, callback, connectionId } =
      await h.authorizeAndCallback({
        provider: h.noscopeProviderId,
        connectionId: 'noscope-flow',
      })

    expect(callback.status).toBe(200)
    expect(new URL(authorizeUrl).searchParams.has('scope')).toBe(false)

    await h.fetch(`/api/oauth/connections/${connectionId}`, {
      method: 'DELETE',
    })
  })

  it('stores tokens with no refresh_token and no expires_in', async () => {
    h.stub.nextTokenResponse = {
      access_token: 'access-forever',
      account_id: 'acct_forever',
    }

    const { connectionId, callback } = await h.authorizeAndCallback({
      connectionId: 'no-expiry',
    })
    expect(callback.status).toBe(200)

    const got: {
      connection: { expires_at: string | null }
    } = await (await h.fetch(`/api/oauth/connections/${connectionId}`)).json()
    expect(got.connection.expires_at).toBeNull()

    await h.fetch(`/api/oauth/connections/${connectionId}`, {
      method: 'DELETE',
    })
  })

  it('rejects expired authorization state', async () => {
    const authorizeRes = await h.fetch(`/api/oauth/${h.providerId}/authorize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connection_id: 'expired-state' }),
    })
    const authorizeJson: { authorize_url: string; state: string } =
      await authorizeRes.json()

    await h.db
      .update(oauthStates)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(oauthStates.id, authorizeJson.state))

    const consentRes = await fetch(authorizeJson.authorize_url, {
      redirect: 'manual',
    })
    const location = consentRes.headers.get('location')
    expect(location).toBeTruthy()

    const callback = await h.fetch(
      new URL(location!).pathname + new URL(location!).search,
    )
    expect(callback.status).toBe(400)
    const body: { error: { code: string } } = await callback.json()
    expect(body.error.code).toBe('expired_state')
  })

  it('requires reauthorization when an expired connection has no refresh token', async () => {
    h.stub.nextTokenResponse = {
      access_token: 'access-no-refresh',
      expires_in: 1,
    }

    const { connectionId, callback } = await h.authorizeAndCallback({
      connectionId: 'no-refresh',
    })
    expect(callback.status).toBe(200)

    await h.db
      .update(oauthConnections)
      .set({
        expiresAt: new Date(Date.now() - 120_000),
        refreshToken: null,
      })
      .where(eq(oauthConnections.connectionId, connectionId))

    const tokenRes = await h.fetch(
      `/api/oauth/connections/${connectionId}/token`,
    )
    expect(tokenRes.status).toBe(401)
    const body: { error: { code: string } } = await tokenRes.json()
    expect(body.error.code).toBe('reauthorization_required')

    await h.fetch(`/api/oauth/connections/${connectionId}`, {
      method: 'DELETE',
    })
  })

  it('returns 502 when the token endpoint returns non-JSON', async () => {
    const authorizeRes = await h.fetch(`/api/oauth/${h.providerId}/authorize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connection_id: 'non-json-token' }),
    })
    const authorizeJson: { authorize_url: string } = await authorizeRes.json()
    const consentRes = await fetch(authorizeJson.authorize_url, {
      redirect: 'manual',
    })
    const location = consentRes.headers.get('location')
    expect(location).toBeTruthy()

    h.stub.nextTokenNonJson = true

    const callback = await h.fetch(
      new URL(location!).pathname + new URL(location!).search,
    )
    expect(callback.status).toBe(502)
    const body: { error: { code: string; message: string } } =
      await callback.json()
    expect(body.error.code).toBe('token_exchange_failed')
    expect(body.error.message).toContain('non-JSON')
  })

  it('rejects a missing or invalid encryption key', async () => {
    const previous = h.env.OAUTH_ENCRYPTION_KEY

    const authorizeRes = await h.fetch(`/api/oauth/${h.providerId}/authorize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connection_id: 'missing-enc-key' }),
    })
    const authorizeJson: { authorize_url: string } = await authorizeRes.json()
    const consentRes = await fetch(authorizeJson.authorize_url, {
      redirect: 'manual',
    })
    const location = consentRes.headers.get('location')!

    h.env.OAUTH_ENCRYPTION_KEY = undefined
    const missingKey = await h.fetch(
      new URL(location).pathname + new URL(location).search,
    )
    expect(missingKey.status).toBe(500)
    const missingKeyBody: { error: { code: string } } = await missingKey.json()
    expect(missingKeyBody.error.code).toBe('missing_configuration')

    h.env.OAUTH_ENCRYPTION_KEY = previous
    const authorizeRes2 = await h.fetch(
      `/api/oauth/${h.providerId}/authorize`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ connection_id: 'bad-enc-key' }),
      },
    )
    const authorizeJson2: { authorize_url: string } = await authorizeRes2.json()
    const consentRes2 = await fetch(authorizeJson2.authorize_url, {
      redirect: 'manual',
    })
    const location2 = consentRes2.headers.get('location')!

    // Valid base64, but not 32 bytes — hits the length check in importKey.
    h.env.OAUTH_ENCRYPTION_KEY = 'YWJj' // "abc"
    const badKey = await h.fetch(
      new URL(location2).pathname + new URL(location2).search,
    )
    h.env.OAUTH_ENCRYPTION_KEY = previous

    expect(badKey.status).toBe(500)
    const badKeyBody: { error: { code: string } } = await badKey.json()
    expect(badKeyBody.error.code).toBe('invalid_encryption_key')
  })

  it('fails decryption after the encryption key rotates', async () => {
    const { connectionId, callback } = await h.authorizeAndCallback({
      connectionId: 'rotated-key',
    })
    expect(callback.status).toBe(200)

    h.env.OAUTH_ENCRYPTION_KEY = OTHER_ENCRYPTION_KEY
    const tokenRes = await h.fetch(
      `/api/oauth/connections/${connectionId}/token`,
    )
    h.env.OAUTH_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY

    expect(tokenRes.status).toBe(500)
    const body: { error: { code: string } } = await tokenRes.json()
    expect(body.error.code).toBe('decryption_failed')

    await h.fetch(`/api/oauth/connections/${connectionId}`, {
      method: 'DELETE',
    })
  })

  it('defaults BROKER_API_KEY to test outside production', async () => {
    const previousNodeEnv = h.env.NODE_ENV
    const previousKey = h.env.BROKER_API_KEY
    h.env.NODE_ENV = 'development'
    h.env.BROKER_API_KEY = undefined

    const res = await h.fetch('/api/oauth/providers', {
      headers: { Authorization: 'Bearer test' },
    })

    h.env.NODE_ENV = previousNodeEnv
    h.env.BROKER_API_KEY = previousKey

    expect(res.status).toBe(200)
  })

  it('requires BROKER_API_KEY in production when unset', async () => {
    const previousNodeEnv = h.env.NODE_ENV
    const previousKey = h.env.BROKER_API_KEY
    h.env.NODE_ENV = 'production'
    h.env.BROKER_API_KEY = undefined

    const res = await h.fetch('/api/oauth/providers')

    h.env.NODE_ENV = previousNodeEnv
    h.env.BROKER_API_KEY = previousKey

    expect(res.status).toBe(500)
    const body: { error: { code: string } } = await res.json()
    expect(body.error.code).toBe('missing_configuration')
  })

  it('falls back to the request origin when OAUTH_REDIRECT_BASE_URL is unset', async () => {
    const previous = h.env.OAUTH_REDIRECT_BASE_URL
    h.env.OAUTH_REDIRECT_BASE_URL = undefined

    const res = await h.fetch('/api/oauth/providers')
    h.env.OAUTH_REDIRECT_BASE_URL = previous

    expect(res.status).toBe(200)
    const body: {
      providers: Array<{ id: string; callback_url: string }>
    } = await res.json()
    const stub = body.providers.find((p) => p.id === h.providerId)
    expect(stub?.callback_url).toBe(
      `${API_ORIGIN}/api/oauth/${h.providerId}/callback`,
    )
  })

  it('purges expired oauth states', async () => {
    await h.db.insert(oauthStates).values({
      id: 'expired-housekeeping',
      connectionId: 'housekeeping',
      provider: h.providerId,
      codeVerifier: null,
      redirectUri: `${API_ORIGIN}/api/oauth/${h.providerId}/callback`,
      returnTo: null,
      scopes: [],
      expiresAt: new Date(Date.now() - 60_000),
    })

    const purged = await purgeExpiredStates(h.db)
    expect(purged).toBeGreaterThanOrEqual(1)
  })

  it('uses registration keys as slugs and allows application overrides', () => {
    const original = h.providers.getProvider('notion')
    const replacement: OAuthProvider = {
      label: 'Nope',
      defaultScopes: [],
      availableScopes: [],
      usesPkce: false,
      createAuthorization: () => ({ url: 'http://example.com' }),
      exchangeCode: async () => ({ payload: {} }),
    }

    h.providers.register({ notion: replacement })
    expect(h.providers.getProvider('notion')).toBe(replacement)

    if (original) h.providers.register({ notion: original })
  })

  it('errors when no database source is configured', async () => {
    const previousDb = h.env.DB
    const previousUrl = h.env.DATABASE_URL
    h.env.DB = undefined
    h.env.DATABASE_URL = undefined

    const res = await h.fetch(`/api/oauth/${h.providerId}/authorize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    h.env.DB = previousDb
    h.env.DATABASE_URL = previousUrl

    expect(res.status).toBe(500)
    const body: { error: { code: string; message: string } } = await res.json()
    expect(body.error.code).toBe('missing_configuration')
    expect(body.error.message).toMatch(/DATABASE_URL|env\.DB/)
  })

  it('builds a Postgres client when DATABASE_URL is set and DB is absent', async () => {
    const { createPostgresDatabase } = await import('../src/db/postgres')
    const client = createPostgresDatabase(
      'postgresql://user:pass@db.example.com/postgres',
    )
    expect(client).toBeTruthy()

    const previousDb = h.env.DB
    const previousUrl = h.env.DATABASE_URL
    h.env.DB = undefined
    // Point at a non-routable host so we never accidentally hit a real DB; the
    // middleware constructs the client before the handler queries.
    h.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:1/postgres'

    const res = await h.fetch(`/api/oauth/${h.providerId}/authorize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connection_id: 'postgres-path' }),
    })

    h.env.DB = previousDb
    h.env.DATABASE_URL = previousUrl

    // Client was built; the subsequent query fails talking to 127.0.0.1:1.
    // Either a broker error or an unexpected 500 from the driver is fine —
    // what matters is we exercised createPostgresDatabase + the middleware branch.
    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})
