import { z } from '@hono/zod-openapi'
import { and, eq, lt } from 'drizzle-orm'
import {
  type OAuthConnection,
  oauthConnections,
  oauthStates,
} from '../db/schema'
import type { Database } from '../db/types'
import {
  type BrokerEnv,
  type ProviderConfig,
  resolveProviderConfig,
} from './config'
import {
  createPkcePair,
  decryptSecret,
  encryptSecret,
  randomToken,
} from './crypto'
import { BrokerError } from './errors'

/** How long a pending authorization stays valid. */
const STATE_TTL_MS = 10 * 60 * 1000

/** Refresh a little early so a token can't expire mid-flight downstream. */
const REFRESH_LEEWAY_MS = 60 * 1000

const tokenResponseSchema = z.looseObject({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.coerce.number().int().positive().optional(),
  scope: z.union([z.string(), z.array(z.string())]).optional(),
})

function requireEncryptionKey(env: BrokerEnv): string {
  const key = env.OAUTH_ENCRYPTION_KEY

  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new BrokerError(
      500,
      'missing_configuration',
      'OAUTH_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32',
    )
  }

  return key.trim()
}

function parseScopeValue(
  value: string | string[] | undefined,
  separator: string,
): string[] {
  if (value === undefined) return []
  if (Array.isArray(value)) return value

  return value
    .split(separator === ',' ? /[\s,]+/ : /\s+/)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0)
}

// ---------------------------------------------------------------------------
// Step 1: build the consent URL
// ---------------------------------------------------------------------------

export type StartAuthorizationInput = {
  userId: string
  provider: string
  redirectUri: string
  /** Overrides the provider's configured scopes for this one flow. */
  scopes?: string[]
  /** Where the callback should send the browser when it finishes. */
  returnTo?: string
}

export async function startAuthorization(
  db: Database,
  env: BrokerEnv,
  input: StartAuthorizationInput,
): Promise<{ authorizeUrl: string; state: string; expiresAt: Date }> {
  const config = resolveProviderConfig(env, input.provider)
  const { definition } = config

  const scopes = input.scopes?.length ? input.scopes : config.scopes
  const state = randomToken(32)
  const pkce = definition.usePkce ? await createPkcePair() : undefined
  const expiresAt = new Date(Date.now() + STATE_TTL_MS)

  await db.insert(oauthStates).values({
    id: state,
    userId: input.userId,
    provider: definition.id,
    codeVerifier: pkce?.verifier ?? null,
    redirectUri: input.redirectUri,
    returnTo: input.returnTo ?? null,
    scopes,
    expiresAt,
  })

  const url = new URL(definition.authorizeUrl)
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', state)

  if (scopes.length > 0) {
    url.searchParams.set('scope', scopes.join(definition.scopeSeparator))
  }

  for (const [key, value] of Object.entries(definition.authorizeParams ?? {})) {
    url.searchParams.set(key, value)
  }

  if (pkce) {
    url.searchParams.set('code_challenge', pkce.challenge)
    url.searchParams.set('code_challenge_method', 'S256')
  }

  return { authorizeUrl: url.toString(), state, expiresAt }
}

// ---------------------------------------------------------------------------
// Token endpoint plumbing
// ---------------------------------------------------------------------------

async function callTokenEndpoint(
  config: ProviderConfig,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const { definition } = config
  const headers = new Headers({ Accept: 'application/json' })
  const body = { ...params }

  if (definition.clientAuth === 'basic') {
    headers.set(
      'Authorization',
      `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
    )
  } else {
    body.client_id = config.clientId
    body.client_secret = config.clientSecret
  }

  let payload: string

  if (definition.tokenRequestFormat === 'json') {
    headers.set('Content-Type', 'application/json')
    payload = JSON.stringify(body)
  } else {
    headers.set('Content-Type', 'application/x-www-form-urlencoded')
    payload = new URLSearchParams(body).toString()
  }

  const response = await fetch(definition.tokenUrl, {
    method: 'POST',
    headers,
    body: payload,
  })

  const text = await response.text()

  if (!response.ok) {
    throw new BrokerError(
      502,
      'token_exchange_failed',
      `${definition.label} token endpoint returned ${response.status}: ${text.slice(0, 500)}`,
    )
  }

  try {
    return JSON.parse(text)
  } catch {
    throw new BrokerError(
      502,
      'token_exchange_failed',
      `${definition.label} token endpoint returned a non-JSON body: ${text.slice(0, 200)}`,
    )
  }
}

type StoredTokenFields = {
  accessToken: string
  refreshToken: string | null
  tokenType: string
  scopes: string[]
  expiresAt: Date | null
  metadata: Record<string, unknown>
  externalAccountId: string | null
  externalAccountLabel: string | null
}

async function toStoredFields(
  env: BrokerEnv,
  config: ProviderConfig,
  raw: Record<string, unknown>,
  fallbackScopes: string[],
  previousRefreshToken?: string | null,
): Promise<StoredTokenFields> {
  const parsed = tokenResponseSchema.parse(raw)
  const encryptionKey = requireEncryptionKey(env)

  const scopes = parseScopeValue(parsed.scope, config.definition.scopeSeparator)

  // Providers commonly omit refresh_token on refresh; keep the one we hold.
  const refreshToken = parsed.refresh_token ?? previousRefreshToken ?? null

  const account = config.definition.describeAccount?.(raw) ?? {}

  // Keep the provider payload, minus anything credential-shaped. Tokens live
  // in the encrypted columns; `id_token` is a signed identity assertion we
  // have no reason to retain in plaintext.
  const metadata: Record<string, unknown> = { ...raw }
  delete metadata.access_token
  delete metadata.refresh_token
  delete metadata.id_token

  return {
    accessToken: await encryptSecret(encryptionKey, parsed.access_token),
    refreshToken: refreshToken
      ? await encryptSecret(encryptionKey, refreshToken)
      : null,
    tokenType: parsed.token_type ?? 'Bearer',
    scopes: scopes.length > 0 ? scopes : fallbackScopes,
    expiresAt: parsed.expires_in
      ? new Date(Date.now() + parsed.expires_in * 1000)
      : null,
    metadata,
    externalAccountId: account.id ?? null,
    externalAccountLabel: account.label ?? null,
  }
}

// ---------------------------------------------------------------------------
// Step 2: consume the callback
// ---------------------------------------------------------------------------

export async function completeAuthorization(
  db: Database,
  env: BrokerEnv,
  input: { provider: string; code: string; state: string },
): Promise<{ connection: OAuthConnection; returnTo: string | null }> {
  // Single-use: delete-and-return so a replayed code can't be redeemed twice.
  const [pending] = await db
    .delete(oauthStates)
    .where(
      and(
        eq(oauthStates.id, input.state),
        eq(oauthStates.provider, input.provider),
      ),
    )
    .returning()

  if (!pending) {
    throw new BrokerError(
      400,
      'invalid_state',
      'Authorization state is unknown or has already been used.',
    )
  }

  if (pending.expiresAt.getTime() < Date.now()) {
    throw new BrokerError(
      400,
      'expired_state',
      'Authorization state expired. Start the flow again.',
    )
  }

  const config = resolveProviderConfig(env, input.provider)

  const params: Record<string, string> = {
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: pending.redirectUri,
  }

  if (pending.codeVerifier) params.code_verifier = pending.codeVerifier

  const raw = await callTokenEndpoint(config, params)
  const fields = await toStoredFields(env, config, raw, pending.scopes)

  const [connection] = await db
    .insert(oauthConnections)
    .values({
      userId: pending.userId,
      provider: config.definition.id,
      ...fields,
    })
    .onConflictDoUpdate({
      target: [oauthConnections.userId, oauthConnections.provider],
      set: { ...fields, updatedAt: new Date() },
    })
    .returning()

  return { connection, returnTo: pending.returnTo }
}

// ---------------------------------------------------------------------------
// Step 3: hand out a usable access token
// ---------------------------------------------------------------------------

async function refreshConnection(
  db: Database,
  env: BrokerEnv,
  connection: OAuthConnection,
): Promise<OAuthConnection> {
  const config = resolveProviderConfig(env, connection.provider)
  const encryptionKey = requireEncryptionKey(env)

  if (!connection.refreshToken || !config.definition.supportsRefresh) {
    throw new BrokerError(
      401,
      'reauthorization_required',
      `The ${config.definition.label} connection for user "${connection.userId}" expired and has no refresh token. Start the flow again.`,
    )
  }

  const refreshToken = await decryptSecret(
    encryptionKey,
    connection.refreshToken,
  )

  const raw = await callTokenEndpoint(config, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })

  const fields = await toStoredFields(
    env,
    config,
    raw,
    connection.scopes,
    refreshToken,
  )

  const [updated] = await db
    .update(oauthConnections)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(oauthConnections.id, connection.id))
    .returning()

  return updated
}

function isExpired(connection: OAuthConnection): boolean {
  if (!connection.expiresAt) return false

  return connection.expiresAt.getTime() - REFRESH_LEEWAY_MS <= Date.now()
}

export async function findConnection(
  db: Database,
  userId: string,
  provider: string,
): Promise<OAuthConnection | undefined> {
  const [connection] = await db
    .select()
    .from(oauthConnections)
    .where(
      and(
        eq(oauthConnections.userId, userId),
        eq(oauthConnections.provider, provider),
      ),
    )
    .limit(1)

  return connection
}

export type AccessTokenResult = {
  provider: string
  userId: string
  accessToken: string
  tokenType: string
  scopes: string[]
  expiresAt: Date | null
  refreshed: boolean
}

/**
 * The endpoint the rest of your stack actually calls: returns a token that is
 * valid right now, refreshing transparently when it is about to expire.
 */
export async function getAccessToken(
  db: Database,
  env: BrokerEnv,
  userId: string,
  provider: string,
): Promise<AccessTokenResult> {
  const existing = await findConnection(db, userId, provider)

  if (!existing) {
    throw new BrokerError(
      404,
      'not_connected',
      `User "${userId}" has no ${provider} connection.`,
    )
  }

  const refreshed = isExpired(existing)
  const connection = refreshed
    ? await refreshConnection(db, env, existing)
    : existing

  return {
    provider: connection.provider,
    userId: connection.userId,
    accessToken: await decryptSecret(
      requireEncryptionKey(env),
      connection.accessToken,
    ),
    tokenType: connection.tokenType,
    scopes: connection.scopes,
    expiresAt: connection.expiresAt,
    refreshed,
  }
}

export async function listConnections(
  db: Database,
  userId: string,
): Promise<OAuthConnection[]> {
  return db
    .select()
    .from(oauthConnections)
    .where(eq(oauthConnections.userId, userId))
}

export async function deleteConnection(
  db: Database,
  userId: string,
  provider: string,
): Promise<boolean> {
  const deleted = await db
    .delete(oauthConnections)
    .where(
      and(
        eq(oauthConnections.userId, userId),
        eq(oauthConnections.provider, provider),
      ),
    )
    .returning()

  return deleted.length > 0
}

/** Housekeeping for abandoned flows. */
export async function purgeExpiredStates(db: Database): Promise<number> {
  const deleted = await db
    .delete(oauthStates)
    .where(lt(oauthStates.expiresAt, new Date()))
    .returning()

  return deleted.length
}
