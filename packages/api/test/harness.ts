import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  createProviderRegistry,
  createSecretProvider,
  type OAuthProvider,
  type OAuthProviderTemplate,
  ProviderConfigurationError,
  ProviderRequestError,
} from '@hookfish/provider'
import { z } from 'zod'
import { pglite } from '../../database/src/pglite'
import type { Database } from '../src/db/types'
import { type HookfishConfig, HookfishServer } from '../src/index'
import type { BrokerEnv } from '../src/oauth/config'
import { type OAuthStub, startOAuthStub } from './stub-oauth'

/** 32 zero bytes, base64 — valid AES-GCM key for tests only. */
export const TEST_ENCRYPTION_KEY =
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

export const API_ORIGIN = 'http://127.0.0.1:8787'

const tokenPayloadSchema = z.record(z.string(), z.unknown())
const authorizationRequiredSchema = z.object({
  error: z.object({
    code: z.string(),
    authorize_url: z.url(),
  }),
})

function stubProvider(stub: OAuthStub): OAuthProvider {
  async function token(params: Record<string, string>) {
    const response = await fetch(stub.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ...params,
        client_id: 'stub-client',
        client_secret: 'stub-secret',
      }),
    })
    const text = await response.text()
    if (!response.ok) {
      throw new ProviderRequestError(
        `Stub token endpoint returned ${response.status}: ${text}`,
      )
    }
    const payload = tokenPayloadSchema.parse(JSON.parse(text))
    return {
      payload,
      account: { id: 'acct_stub', label: 'Stub Account' },
    }
  }

  return {
    label: 'Stub OAuth',
    defaultScopes: ['read', 'write'],
    createAuthorization({ redirectUri, state, scopes }) {
      const url = new URL(stub.authorizeUrl)
      url.searchParams.set('client_id', 'stub-client')
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('state', state)
      url.searchParams.set('scope', scopes.join(' '))
      return { url: url.toString() }
    },
    exchangeCode({ code, redirectUri }) {
      return token({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      })
    },
    refreshToken({ refreshToken }) {
      return token({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      })
    },
  }
}

function stubMcpProvider(stub: OAuthStub): OAuthProviderTemplate {
  const oauth = stubProvider(stub)
  return {
    ...oauth,
    authentication: 'oauth',
    inputSchema: {
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
    normalizeConfiguration(configuration) {
      if (typeof configuration.resource_url !== 'string') {
        throw new ProviderConfigurationError('MCP resource URL is required.')
      }
      return {
        resource_url: new URL(configuration.resource_url).toString(),
      }
    },
    async registerClient() {
      return { clientId: 'stub-mcp-client' }
    },
    createProvider() {
      return oauth
    },
  }
}

export type TestHarness = {
  env: BrokerEnv
  stub: OAuthStub
  db: Database
  fetch(path: string, init?: RequestInit): Promise<Response>
  authorize(path?: string): Promise<{
    authorizeUrl: string
    state: string
    callbackUrl: string
  }>
  close(): Promise<void>
}

export async function createHarness(
  options: Pick<
    HookfishConfig<BrokerEnv>,
    'auth' | 'clientOrigins' | 'rawApiOrigins' | 'returnTo' | 'trustedOrigins'
  > = {},
): Promise<TestHarness> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'hookfish-connections-'))
  const stub = await startOAuthStub()
  const database = pglite(dataDir)
  const db = await database.getDatabase({})
  const env: BrokerEnv = {
    NODE_ENV: 'test',
    OAUTH_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    OAUTH_REDIRECT_BASE_URL: API_ORIGIN,
    HOOKFISH_API_KEY: 'test',
  }
  const app = await HookfishServer.init({
    db,
    providers: createProviderRegistry({
      stub: stubProvider(stub),
      mcp: stubMcpProvider(stub),
      secret: createSecretProvider('Static secret'),
    }),
    ...options,
  })

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

  const authorize = async (connectionPath = 'user/personal/stub') => {
    const response = await apiFetch(
      `/api/connections/access/${connectionPath}`,
      { method: 'POST' },
    )
    const body = authorizationRequiredSchema.parse(await response.json())
    if (
      response.status !== 401 ||
      body.error.code !== 'authorization_required'
    ) {
      throw new Error(
        `Expected authorization_required, got ${response.status}.`,
      )
    }
    const authorizeUrl = body.error.authorize_url
    const state = new URL(authorizeUrl).searchParams.get('state')
    if (!state) throw new Error('Authorization URL did not include state.')
    const consent = await fetch(authorizeUrl, { redirect: 'manual' })
    const callbackUrl = consent.headers.get('location')
    if (!callbackUrl) throw new Error('Stub did not return a callback URL.')
    return { authorizeUrl, state, callbackUrl }
  }

  return {
    env,
    stub,
    db,
    fetch: apiFetch,
    authorize,
    close: async () => {
      await stub.close()
      await rm(dataDir, { recursive: true, force: true })
    },
  }
}
