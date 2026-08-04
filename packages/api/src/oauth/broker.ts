import { z } from '@hono/zod-openapi'
import {
  defaultProviderRegistry,
  ProviderConfigurationError,
  type ProviderRegistry,
  ProviderRequestError,
  type ProviderTokenResponse,
} from '@hookfish/provider'
import { and, eq, lt, or, sql } from 'drizzle-orm'
import {
  type Database,
  type OAuthConnection,
  oauthConnections,
  oauthStates,
} from '../db/schema'
import { readEnvString, resolveProviderConfig } from './config'
import { generateConnectionId } from './connection-id'
import { decryptSecret, encryptSecret, randomToken } from './crypto'
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

function requireEncryptionKey(env: object): string {
  const key = readEnvString(env, 'OAUTH_ENCRYPTION_KEY')

  if (!key) {
    throw new BrokerError(
      500,
      'missing_configuration',
      'OAUTH_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32',
    )
  }

  return key
}

function parseScopeValue(value: string | string[] | undefined): string[] {
  if (value === undefined) return []
  if (Array.isArray(value)) return value

  return (
    value
      // Authorization requests may use a different separator than token
      // responses. GitHub, for example, requests space-delimited scopes but
      // returns them comma-delimited.
      .split(/[\s,]+/)
      .map((scope) => scope.trim())
      .filter((scope) => scope.length > 0)
  )
}

// ---------------------------------------------------------------------------
// Step 1: build the consent URL
// ---------------------------------------------------------------------------

export type StartAuthorizationInput = {
  /** Omit to mint an id that is not yet in use. */
  connectionId?: string
  /** Places an automatically minted id below this slash-delimited prefix. */
  connectionIdPrefix?: string
  provider: string
  redirectUri: string
  /** Overrides the provider's configured scopes for this one flow. */
  scopes?: string[]
}

/**
 * A minted id must land on a free row -- reusing one would silently replace
 * somebody else's tokens. The id space is ~2e8, so a collision here means the
 * table is unexpectedly dense rather than that we were unlucky.
 */
const MINT_ATTEMPTS = 8

async function mintConnectionId(
  db: Database,
  prefix?: string,
): Promise<string> {
  for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt++) {
    const generatedId = generateConnectionId()
    const candidate = prefix ? `${prefix}/${generatedId}` : generatedId

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
  env: object,
  input: StartAuthorizationInput,
  providers: ProviderRegistry = defaultProviderRegistry,
): Promise<{
  authorizeUrl: string
  state: string
  expiresAt: Date
  connectionId: string
}> {
  const config = resolveProviderConfig(env, input.provider, providers)
  const { provider } = config

  if (input.connectionId && input.connectionIdPrefix) {
    throw new BrokerError(
      400,
      'invalid_connection_id',
      'Pass either connection_id or connection_id_prefix, not both.',
    )
  }

  // A minted id is already known to be free; a caller-supplied one may be
  // linked to another provider.
  const connectionId =
    input.connectionId ?? (await mintConnectionId(db, input.connectionIdPrefix))

  if (input.connectionId) {
    await assertProviderMatches(db, input.connectionId, input.provider)
  }

  const scopes = input.scopes?.length ? input.scopes : config.scopes
  const state = randomToken(32)
  const expiresAt = new Date(Date.now() + STATE_TTL_MS)
  const authorization = await callProvider(() =>
    provider.createAuthorization({
      redirectUri: input.redirectUri,
      state,
      scopes,
    }),
  )

  await db.insert(oauthStates).values({
    id: state,
    connectionId,
    provider: input.provider,
    codeVerifier: authorization.codeVerifier ?? null,
    redirectUri: input.redirectUri,
    scopes,
    expiresAt,
  })

  return {
    authorizeUrl: authorization.url,
    state,
    expiresAt,
    connectionId,
  }
}

// ---------------------------------------------------------------------------
// Token endpoint plumbing
// ---------------------------------------------------------------------------

async function callProvider<T>(
  operation: () => T | Promise<T>,
  requestErrorCode = 'token_exchange_failed',
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof ProviderConfigurationError) {
      throw new BrokerError(500, 'missing_configuration', error.message)
    }
    if (error instanceof ProviderRequestError) {
      throw new BrokerError(502, requestErrorCode, error.message)
    }
    throw error
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
  env: object,
  response: ProviderTokenResponse,
  fallbackScopes: string[],
  previousRefreshToken?: string | null,
): Promise<StoredTokenFields> {
  const raw = response.payload
  const parsed = tokenResponseSchema.parse(raw)
  const encryptionKey = requireEncryptionKey(env)

  const scopes = parseScopeValue(parsed.scope)

  // Providers commonly omit refresh_token on refresh; keep the one we hold.
  const refreshToken = parsed.refresh_token ?? previousRefreshToken ?? null

  const account = response.account ?? {}

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
  env: object,
  input: { provider: string; code: string; state: string },
  providers: ProviderRegistry = defaultProviderRegistry,
): Promise<OAuthConnection> {
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

  const config = resolveProviderConfig(env, input.provider, providers)

  // The check in `startAuthorization` goes stale as soon as a second flow is
  // opened on the same id, so re-check before spending the authorization code.
  await assertProviderMatches(db, pending.connectionId, input.provider)

  const response = await callProvider(() =>
    config.provider.exchangeCode({
      code: input.code,
      redirectUri: pending.redirectUri,
      codeVerifier: pending.codeVerifier ?? undefined,
    }),
  )
  const fields = await toStoredFields(env, response, pending.scopes)

  const [connection] = await db
    .insert(oauthConnections)
    .values({
      connectionId: pending.connectionId,
      provider: input.provider,
      ...fields,
    })
    .onConflictDoUpdate({
      target: oauthConnections.connectionId,
      set: { ...fields, updatedAt: new Date() },
      // Reconnecting the same link upserts; a different provider must not take
      // the id over. Enforced in the statement itself, so two callbacks racing
      // past the checks above can't rebind it either -- the loser updates no
      // rows and returns nothing.
      setWhere: eq(oauthConnections.provider, input.provider),
    })
    .returning()

  if (!connection) {
    throw new BrokerError(
      409,
      'connection_id_in_use',
      `Connection "${pending.connectionId}" was linked to another provider while this flow was in progress. Start again with a new id.`,
    )
  }

  return connection
}

// ---------------------------------------------------------------------------
// Step 3: hand out a usable access token
// ---------------------------------------------------------------------------

async function refreshConnection(
  db: Database,
  env: object,
  connection: OAuthConnection,
  providers: ProviderRegistry,
): Promise<OAuthConnection> {
  const config = resolveProviderConfig(env, connection.provider, providers)
  const encryptionKey = requireEncryptionKey(env)

  if (!connection.refreshToken || !config.provider.refreshToken) {
    throw new BrokerError(
      401,
      'reauthorization_required',
      `The ${config.provider.label ?? connection.provider} connection "${connection.connectionId}" expired and has no refresh token. Start the flow again.`,
    )
  }

  const refresh = config.provider.refreshToken.bind(config.provider)

  const refreshToken = await decryptSecret(
    encryptionKey,
    connection.refreshToken,
  )

  const response = await callProvider(() =>
    refresh({
      refreshToken,
    }),
  )

  const fields = await toStoredFields(
    env,
    response,
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
  env: object,
  connectionId: string,
  providers: ProviderRegistry = defaultProviderRegistry,
): Promise<AccessTokenResult> {
  const existing = await getConnection(db, connectionId)

  const refreshed = isExpired(existing)
  const connection = refreshed
    ? await refreshConnection(db, env, existing, providers)
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
  options: { provider?: string; connectionIdPrefix?: string } = {},
): Promise<OAuthConnection[]> {
  const providerFilter = options.provider
    ? eq(oauthConnections.provider, options.provider)
    : undefined
  const prefixFilter = options.connectionIdPrefix
    ? options.connectionIdPrefix.endsWith('/')
      ? sql<boolean>`starts_with(${oauthConnections.connectionId}, ${options.connectionIdPrefix})`
      : or(
          eq(oauthConnections.connectionId, options.connectionIdPrefix),
          sql<boolean>`starts_with(${oauthConnections.connectionId}, ${`${options.connectionIdPrefix}/`})`,
        )
    : undefined

  return db
    .select()
    .from(oauthConnections)
    .where(and(providerFilter, prefixFilter))
}

export type DeleteConnectionResult = {
  deleted: boolean
  revocation: 'revoked' | 'unsupported' | 'not_found'
}

export async function deleteConnection(
  db: Database,
  env: object,
  connectionId: string,
  providers: ProviderRegistry = defaultProviderRegistry,
): Promise<DeleteConnectionResult> {
  const connection = await findConnection(db, connectionId)

  if (!connection) {
    return { deleted: false, revocation: 'not_found' }
  }

  const provider = providers.getProvider(connection.provider)
  const revokeToken = provider?.revokeToken?.bind(provider)
  let revocation: DeleteConnectionResult['revocation'] = 'unsupported'

  if (revokeToken) {
    const key = requireEncryptionKey(env)
    const [accessToken, refreshToken] = await Promise.all([
      decryptSecret(key, connection.accessToken),
      connection.refreshToken
        ? decryptSecret(key, connection.refreshToken)
        : undefined,
    ])

    await callProvider(
      () => revokeToken({ accessToken, refreshToken }),
      'token_revocation_failed',
    )
    revocation = 'revoked'
  }

  const deleted = await db
    .delete(oauthConnections)
    .where(eq(oauthConnections.id, connection.id))
    .returning()

  return { deleted: deleted.length > 0, revocation }
}

/** Housekeeping for abandoned flows. */
export async function purgeExpiredStates(db: Database): Promise<number> {
  const deleted = await db
    .delete(oauthStates)
    .where(lt(oauthStates.expiresAt, new Date()))
    .returning()

  return deleted.length
}
