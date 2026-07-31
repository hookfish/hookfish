import { z } from '@hono/zod-openapi'
import { and, eq, lt } from 'drizzle-orm'
import {
  type Database,
  type OAuthConnection,
  oauthConnections,
  oauthStates,
} from '../db/schema'
import {
  type BrokerEnv,
  type ProviderConfig,
  resolveProviderConfig,
} from './config'
import { generateConnectionId } from './connection-id'
import {
  createPkcePair,
  decryptSecret,
  encryptSecret,
  randomToken,
} from './crypto'
import { BrokerError } from './errors'
import { describeAccountFromFields } from './providers'

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
  /** Omit to mint an id that is not yet in use. */
  connectionId?: string
  provider: string
  redirectUri: string
  /** Overrides the provider's configured scopes for this one flow. */
  scopes?: string[]
  /** Where the callback should send the browser when it finishes. */
  returnTo?: string
}

/**
 * A minted id must land on a free row -- reusing one would silently replace
 * somebody else's tokens. The id space is ~2e8, so a collision here means the
 * table is unexpectedly dense rather than that we were unlucky.
 */
const MINT_ATTEMPTS = 8

async function mintConnectionId(db: Database): Promise<string> {
  for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt++) {
    const candidate = generateConnectionId()

    if (!(await findConnection(db, candidate))) return candidate
  }

  throw new BrokerError(
    500,
    'connection_id_unavailable',
    `Could not mint an unused connection id in ${MINT_ATTEMPTS} attempts.`,
  )
}

/** A connection id is one provider link -- never let a second provider take it. */
async function assertProviderMatches(
  db: Database,
  connectionId: string,
  provider: string,
): Promise<void> {
  const existing = await findConnection(db, connectionId)

  if (existing && existing.provider !== provider) {
    throw new BrokerError(
      409,
      'connection_id_in_use',
      `Connection "${connectionId}" is already linked to ${existing.provider}. Mint a new id for ${provider}.`,
    )
  }
}

export async function startAuthorization(
  db: Database,
  env: BrokerEnv,
  input: StartAuthorizationInput,
): Promise<{
  authorizeUrl: string
  state: string
  expiresAt: Date
  connectionId: string
}> {
  const config = await resolveProviderConfig(db, env, input.provider)
  const { definition } = config

  // A minted id is already known to be free; a caller-supplied one may be
  // linked to another provider.
  const connectionId = input.connectionId ?? (await mintConnectionId(db))

  if (input.connectionId) {
    await assertProviderMatches(db, input.connectionId, definition.id)
  }

  const scopes = input.scopes?.length ? input.scopes : config.scopes
  const state = randomToken(32)
  const pkce = definition.usePkce ? await createPkcePair() : undefined
  const expiresAt = new Date(Date.now() + STATE_TTL_MS)

  await db.insert(oauthStates).values({
    id: state,
    connectionId,
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

  return { authorizeUrl: url.toString(), state, expiresAt, connectionId }
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

  const account = describeAccountFromFields(config.definition, raw)

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

  const config = await resolveProviderConfig(db, env, input.provider)

  // The check in `startAuthorization` goes stale as soon as a second flow is
  // opened on the same id, so re-check before spending the authorization code.
  await assertProviderMatches(db, pending.connectionId, config.definition.id)

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
      connectionId: pending.connectionId,
      provider: config.definition.id,
      ...fields,
    })
    .onConflictDoUpdate({
      target: oauthConnections.connectionId,
      set: { ...fields, updatedAt: new Date() },
      // Reconnecting the same link upserts; a different provider must not take
      // the id over. Enforced in the statement itself, so two callbacks racing
      // past the checks above can't rebind it either -- the loser updates no
      // rows and returns nothing.
      setWhere: eq(oauthConnections.provider, config.definition.id),
    })
    .returning()

  if (!connection) {
    throw new BrokerError(
      409,
      'connection_id_in_use',
      `Connection "${pending.connectionId}" was linked to another provider while this flow was in progress. Start again with a new id.`,
    )
  }

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
  const config = await resolveProviderConfig(db, env, connection.provider)
  const encryptionKey = requireEncryptionKey(env)

  if (!connection.refreshToken || !config.definition.supportsRefresh) {
    throw new BrokerError(
      401,
      'reauthorization_required',
      `The ${config.definition.label} connection "${connection.connectionId}" expired and has no refresh token. Start the flow again.`,
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
  connectionId: string,
): Promise<OAuthConnection | undefined> {
  const [connection] = await db
    .select()
    .from(oauthConnections)
    .where(eq(oauthConnections.connectionId, connectionId))
    .limit(1)

  return connection
}

export async function getConnection(
  db: Database,
  connectionId: string,
): Promise<OAuthConnection> {
  const connection = await findConnection(db, connectionId)

  if (!connection) {
    throw new BrokerError(
      404,
      'not_connected',
      `No connection "${connectionId}".`,
    )
  }

  return connection
}

export type AccessTokenResult = {
  provider: string
  connectionId: string
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
  connectionId: string,
): Promise<AccessTokenResult> {
  const existing = await getConnection(db, connectionId)

  const refreshed = isExpired(existing)
  const connection = refreshed
    ? await refreshConnection(db, env, existing)
    : existing

  return {
    provider: connection.provider,
    connectionId: connection.connectionId,
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
  options: { provider?: string } = {},
): Promise<OAuthConnection[]> {
  if (options.provider) {
    return db
      .select()
      .from(oauthConnections)
      .where(eq(oauthConnections.provider, options.provider))
  }

  return db.select().from(oauthConnections)
}

export async function deleteConnection(
  db: Database,
  connectionId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(oauthConnections)
    .where(eq(oauthConnections.connectionId, connectionId))
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
