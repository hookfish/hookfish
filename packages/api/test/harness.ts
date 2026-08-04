import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { z } from '@hono/zod-openapi'
import {
  createProviderRegistry,
  type OAuthProvider,
  type ProviderRegistry,
  ProviderRequestError,
} from '@hookfish/provider'
import {
  GitHubProvider,
  LinearProvider,
  NotionProvider,
} from '@hookfish/providers'
import { pglite } from '../../database/src/pglite'
import type { Database } from '../src/db/schema'
import { Hookfish } from '../src/index'
import type { BrokerEnv } from '../src/oauth/config'
import { createPkcePair } from '../src/oauth/crypto'
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
  providers: ProviderRegistry
  fetch: (path: string, init?: RequestInit) => Promise<Response>
  authorizeAndCallback: (options?: {
    provider?: string
    connectionId?: string
    scopes?: string[]
  }) => Promise<{
    connectionId: string
    state: string
    authorizeUrl: string
    callback: Response
  }>
  close: () => Promise<void>
}

type StubProviderOptions = {
  defaultScopes?: string[]
  formatScopes?: (scopes: string[]) => string
  tokenRequest?: 'form-body' | 'json-basic'
  usesPkce?: boolean
  authorizeParams?: Record<string, string>
  supportsRefresh?: boolean
}

const stubTokenSchema = z.looseObject({})

function basicAuthorization(clientId: string, clientSecret: string) {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`
}

async function readTokenPayload(
  response: Response,
  providerLabel: string,
): Promise<Record<string, unknown>> {
  const text = await response.text()

  if (!response.ok) {
    throw new ProviderRequestError(
      `${providerLabel} token endpoint returned ${response.status}: ${text.slice(0, 500)}`,
    )
  }

  try {
    return stubTokenSchema.parse(JSON.parse(text))
  } catch (error) {
    throw new ProviderRequestError(
      `${providerLabel} token endpoint returned a non-JSON body: ${text.slice(0, 200)}`,
      { cause: error },
    )
  }
}

function providerDefinition(
  id: string,
  stub: OAuthStub,
  label: string,
  options: StubProviderOptions = {},
): OAuthProvider {
  const credentials = {
    clientId: `${id}-client`,
    clientSecret: `${id}-secret`,
  }
  const requestToken = async (params: Record<string, string>) => {
    const headers = new Headers({ Accept: 'application/json' })
    let body: string

    if (options.tokenRequest === 'json-basic') {
      headers.set(
        'Authorization',
        basicAuthorization(credentials.clientId, credentials.clientSecret),
      )
      headers.set('Content-Type', 'application/json')
      body = JSON.stringify(params)
    } else {
      headers.set('Content-Type', 'application/x-www-form-urlencoded')
      body = new URLSearchParams({
        ...params,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      }).toString()
    }

    const payload = await readTokenPayload(
      await fetch(stub.tokenUrl, { method: 'POST', headers, body }),
      label,
    )

    return {
      payload,
      account: {
        id:
          typeof payload.account_id === 'string'
            ? payload.account_id
            : undefined,
        label:
          typeof payload.account_label === 'string'
            ? payload.account_label
            : undefined,
      },
    }
  }

  const provider: OAuthProvider = {
    label,
    defaultScopes: options.defaultScopes ?? ['read', 'write'],
    availableScopes: ['read', 'write'],
    usesPkce: options.usesPkce ?? false,

    async createAuthorization({ redirectUri, state, scopes }) {
      const url = new URL(stub.authorizeUrl)
      url.searchParams.set('client_id', credentials.clientId)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('state', state)
      if (scopes.length > 0) {
        url.searchParams.set(
          'scope',
          options.formatScopes?.(scopes) ?? scopes.join(' '),
        )
      }
      for (const [key, value] of Object.entries(
        options.authorizeParams ?? {},
      )) {
        url.searchParams.set(key, value)
      }

      if (!options.usesPkce) return { url: url.toString() }

      const pkce = await createPkcePair()
      url.searchParams.set('code_challenge', pkce.challenge)
      url.searchParams.set('code_challenge_method', 'S256')
      return { url: url.toString(), codeVerifier: pkce.verifier }
    },

    exchangeCode({ code, redirectUri, codeVerifier }) {
      return requestToken({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
      })
    },
  }

  if (options.supportsRefresh !== false) {
    provider.refreshToken = ({ refreshToken }) =>
      requestToken({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      })
  }

  return provider
}

export async function createHarness(
  options: { returnTo?: string } = {},
): Promise<TestHarness> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'oauth-broker-'))
  const stub = await startOAuthStub()

  const providerId = 'stub'
  const altProviderId = 'stub-alt'
  const dialectProviderId = 'stub-dialect'
  const noscopeProviderId = 'stub-noscope'

  const providers = createProviderRegistry({
    notion: new NotionProvider({
      clientId: 'notion-client',
      clientSecret: 'notion-secret',
    }),
    linear: new LinearProvider({
      clientId: 'linear-client',
      clientSecret: 'linear-secret',
    }),
    github: new GitHubProvider({
      clientId: 'github-client',
      clientSecret: 'github-secret',
    }),
    [providerId]: providerDefinition(providerId, stub, 'Stub'),
    [altProviderId]: providerDefinition(altProviderId, stub, 'Stub Alt'),
    [dialectProviderId]: providerDefinition(
      dialectProviderId,
      stub,
      'Stub Dialect',
      {
        tokenRequest: 'json-basic',
        usesPkce: true,
        authorizeParams: { access_type: 'offline', prompt: 'consent' },
        formatScopes: (scopes) => scopes.join(','),
      },
    ),
    [noscopeProviderId]: providerDefinition(
      noscopeProviderId,
      stub,
      'Stub Noscope',
      {
        defaultScopes: [],
        supportsRefresh: false,
      },
    ),
  })
  const database = pglite(dataDir)
  const db = await database.getDatabase({})
  const app = new Hookfish({ providers, db, returnTo: options.returnTo })

  const env: BrokerEnv = {
    ...process.env,
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
    providers,
    fetch: apiFetch,
    authorizeAndCallback,
    close: async () => {
      await stub.close()
      await rm(dataDir, { recursive: true, force: true })
    },
  }
}
