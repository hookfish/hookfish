import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator'
import { createPgliteDatabase } from '../src/db/pglite'
import type { Database } from '../src/db/schema'
import app from '../src/index'
import type { BrokerEnv } from '../src/oauth/config'
import {
  type ProviderDefinition,
  registerProvider,
  unregisterProvider,
} from '../src/oauth/providers'
import { type OAuthStub, startOAuthStub } from './stub-oauth'

/** 32 zero bytes, base64 — valid AES-GCM key for tests only. */
export const TEST_ENCRYPTION_KEY =
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

/** A different valid 32-byte key (all 0xff). */
export const OTHER_ENCRYPTION_KEY =
  '//////////////////////////////////////////8='

export const API_ORIGIN = 'http://127.0.0.1:8787'

export type TestHarness = {
  env: BrokerEnv
  stub: OAuthStub
  providerId: string
  altProviderId: string
  /** PKCE + Basic auth + JSON token body + authorizeParams. */
  dialectProviderId: string
  /** Empty default scopes (no `scope` query param). */
  noscopeProviderId: string
  db: Database
  fetch: (path: string, init?: RequestInit) => Promise<Response>
  authorizeAndCallback: (options?: {
    provider?: string
    connectionId?: string
    returnTo?: string
    scopes?: string[]
  }) => Promise<{
    connectionId: string
    state: string
    authorizeUrl: string
    callback: Response
  }>
  close: () => Promise<void>
}

function providerDefinition(
  id: string,
  stub: OAuthStub,
  label: string,
  overrides: Partial<ProviderDefinition> = {},
): ProviderDefinition {
  return {
    id,
    label,
    authorizeUrl: stub.authorizeUrl,
    tokenUrl: stub.tokenUrl,
    defaultScopes: ['read', 'write'],
    scopeSeparator: ' ',
    tokenRequestFormat: 'form',
    clientAuth: 'body',
    usePkce: false,
    supportsRefresh: true,
    describeAccount: (payload) => ({
      id:
        typeof payload.account_id === 'string' ? payload.account_id : undefined,
      label:
        typeof payload.account_label === 'string'
          ? payload.account_label
          : undefined,
    }),
    ...overrides,
  }
}

export async function createHarness(): Promise<TestHarness> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'oauth-broker-'))
  const stub = await startOAuthStub()

  const providerId = 'stub'
  const altProviderId = 'stub-alt'
  const dialectProviderId = 'stub-dialect'
  const noscopeProviderId = 'stub-noscope'

  registerProvider(providerDefinition(providerId, stub, 'Stub'))
  registerProvider(providerDefinition(altProviderId, stub, 'Stub Alt'))
  registerProvider(
    providerDefinition(dialectProviderId, stub, 'Stub Dialect', {
      tokenRequestFormat: 'json',
      clientAuth: 'basic',
      usePkce: true,
      authorizeParams: { access_type: 'offline', prompt: 'consent' },
      scopeSeparator: ',',
      defaultScopes: ['read', 'write'],
    }),
  )
  registerProvider(
    providerDefinition(noscopeProviderId, stub, 'Stub Noscope', {
      defaultScopes: [],
      supportsRefresh: false,
    }),
  )

  const { db } = await createPgliteDatabase(dataDir)
  const migrationsFolder = path.join(
    path.resolve(fileURLToPath(import.meta.url), '../..'),
    'drizzle',
  )
  await migratePglite(db, { migrationsFolder })

  const env: BrokerEnv = {
    ...process.env,
    DB: db,
    NODE_ENV: 'test',
    OAUTH_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    OAUTH_REDIRECT_BASE_URL: API_ORIGIN,
    BROKER_API_KEY: 'test',
    STUB_CLIENT_ID: 'stub-client',
    STUB_CLIENT_SECRET: 'stub-secret',
    STUB_ALT_CLIENT_ID: 'stub-alt-client',
    STUB_ALT_CLIENT_SECRET: 'stub-alt-secret',
    STUB_DIALECT_CLIENT_ID: 'stub-dialect-client',
    STUB_DIALECT_CLIENT_SECRET: 'stub-dialect-secret',
    STUB_NOSCOPE_CLIENT_ID: 'stub-noscope-client',
    STUB_NOSCOPE_CLIENT_SECRET: 'stub-noscope-secret',
  }

  const apiFetch = async (requestPath: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    if (!headers.has('Authorization')) {
      headers.set('Authorization', 'Bearer test')
    }
    return app.fetch(
      new Request(`${API_ORIGIN}${requestPath}`, { ...init, headers }),
      env,
    )
  }

  const authorizeAndCallback: TestHarness['authorizeAndCallback'] = async (
    options = {},
  ) => {
    const provider = options.provider ?? providerId
    const body: Record<string, unknown> = {}
    if (options.connectionId) body.connection_id = options.connectionId
    if (options.returnTo) body.return_to = options.returnTo
    if (options.scopes) body.scopes = options.scopes

    const authorizeRes = await apiFetch(`/api/oauth/${provider}/authorize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!authorizeRes.ok) {
      throw new Error(
        `authorize failed: ${authorizeRes.status} ${await authorizeRes.text()}`,
      )
    }

    const authorizeJson: {
      connection_id: string
      authorize_url: string
      state: string
    } = await authorizeRes.json()

    // Hit the stub consent URL; it 302s to our callback with code+state.
    const consentRes = await fetch(authorizeJson.authorize_url, {
      redirect: 'manual',
    })
    const location = consentRes.headers.get('location')
    if (!location) {
      throw new Error(`stub authorize did not redirect (${consentRes.status})`)
    }

    const callbackUrl = new URL(location)
    const callback = await apiFetch(
      `${callbackUrl.pathname}${callbackUrl.search}`,
    )

    return {
      connectionId: authorizeJson.connection_id,
      state: authorizeJson.state,
      authorizeUrl: authorizeJson.authorize_url,
      callback,
    }
  }

  return {
    env,
    stub,
    providerId,
    altProviderId,
    dialectProviderId,
    noscopeProviderId,
    db,
    fetch: apiFetch,
    authorizeAndCallback,
    close: async () => {
      unregisterProvider(providerId)
      unregisterProvider(altProviderId)
      unregisterProvider(dialectProviderId)
      unregisterProvider(noscopeProviderId)
      await stub.close()
      await rm(dataDir, { recursive: true, force: true })
    },
  }
}
