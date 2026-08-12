import { z } from '@hono/zod-openapi'
import {
  isOAuthProviderTemplate,
  isSecretProvider,
  type OAuthProvider,
  ProviderConfigurationError,
  ProviderRequestError,
  type ProviderTokenResponse,
} from '@hookfish/provider'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { Connection, Database, OAuthState } from '../db/types'
import {
  type BoundProviderSource,
  defaultBoundProviderSource,
} from '../provider-source'
import {
  decryptSecret,
  encryptSecret,
  hashToken,
  requireEncryptionKey,
} from './crypto'
import { BrokerError } from './errors'
import { formatConnectionPath } from './resource-path'
import { createAuthorizationState } from './state'

const STATE_TTL_MS = 10 * 60 * 1000
const REFRESH_LEEWAY_MS = 60 * 1000

const tokenResponseSchema = z.looseObject({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.coerce.number().int().positive().optional(),
  scope: z.union([z.string(), z.array(z.string())]).optional(),
})

function parseScopeValue(value: string | string[] | undefined): string[] {
  if (value === undefined) return []
  if (Array.isArray(value)) return value
  return value
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean)
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (typeof value !== 'object' || value === null) return JSON.stringify(value)
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(',')}}`
}

async function callProvider<T>(
  operation: () => T | Promise<T>,
  requestErrorCode = 'token_exchange_failed',
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof ProviderConfigurationError) {
      throw new BrokerError(
        400,
        'invalid_connection_configuration',
        error.message,
      )
    }
    if (error instanceof ProviderRequestError) {
      throw new BrokerError(502, requestErrorCode, error.message)
    }
    throw error
  }
}

async function getProvider(providers: BoundProviderSource, providerId: string) {
  const provider = await providers.getProvider(providerId)
  if (!provider) {
    throw new BrokerError(
      404,
      'unknown_provider',
      `Unknown provider "${providerId}".`,
    )
  }
  return provider
}

function normalizeConfiguration(
  provider: Awaited<ReturnType<typeof getProvider>>,
  configuration: Record<string, unknown>,
): Record<string, unknown> {
  if (provider.kind !== 'mcp') {
    if (Object.keys(configuration).length > 0) {
      throw new BrokerError(
        400,
        'connection_configuration_unsupported',
        `Provider "${provider.label ?? 'unknown'}" does not accept per-connection configuration.`,
      )
    }
    return {}
  }
  if (!isOAuthProviderTemplate(provider)) {
    throw new BrokerError(
      500,
      'invalid_provider',
      'The MCP provider does not support per-connection configuration.',
    )
  }
  try {
    return provider.normalizeConfiguration?.(configuration) ?? configuration
  } catch (error) {
    if (error instanceof ProviderConfigurationError) {
      throw new BrokerError(
        400,
        'invalid_connection_configuration',
        error.message,
      )
    }
    throw error
  }
}

export async function ensureConnection(
  db: Database,
  input: {
    organization?: string
    namespace: string
    providerId: string
    configuration?: Record<string, unknown>
  },
  providers: BoundProviderSource = defaultBoundProviderSource,
): Promise<Connection> {
  const organization = input.organization ?? ''
  const provider = await getProvider(providers, input.providerId)
  const existing = await db.getConnection(
    organization,
    input.namespace,
    input.providerId,
  )

  if (existing) {
    if (input.configuration !== undefined) {
      const normalized = normalizeConfiguration(provider, input.configuration)
      if (stableJson(normalized) !== stableJson(existing.configuration)) {
        throw new BrokerError(
          409,
          'connection_configuration_conflict',
          `Connection "${formatConnectionPath(input.namespace, input.providerId)}" already has different configuration.`,
        )
      }
    }
    return existing
  }

  const normalized = normalizeConfiguration(provider, input.configuration ?? {})
  const stored = await db.putConnection({
    organization,
    namespace: input.namespace,
    providerId: input.providerId,
    configuration: normalized,
  })

  if (stableJson(stored.configuration) !== stableJson(normalized)) {
    throw new BrokerError(
      409,
      'connection_configuration_conflict',
      `Connection "${formatConnectionPath(input.namespace, input.providerId)}" was concurrently created with different configuration.`,
    )
  }
  return stored
}

const provisioningLocks = new Map<string, Promise<Connection>>()

async function configureOAuthProvider(
  db: Database,
  env: object,
  connection: Connection,
  providers: BoundProviderSource,
  redirectUri: string,
  clientMetadataUrl: string,
): Promise<{ connection: Connection; provider: OAuthProvider }> {
  const provider = await getProvider(providers, connection.providerId)
  if (isSecretProvider(provider)) {
    throw new BrokerError(
      409,
      'secret_provider',
      'This provider uses a stored secret.',
    )
  }
  if (provider.kind !== 'mcp') return { connection, provider }
  if (!isOAuthProviderTemplate(provider) || !provider.registerClient) {
    throw new BrokerError(
      500,
      'invalid_provider',
      'The MCP provider cannot prepare an OAuth client.',
    )
  }

  let prepared = connection
  if (!prepared.oauthClientId) {
    const lockKey = `${connection.organization}\0${connection.namespace}\0${connection.providerId}`
    let pending = provisioningLocks.get(lockKey)
    if (!pending) {
      pending = (async () => {
        const latest =
          (await db.getConnection(
            connection.organization,
            connection.namespace,
            connection.providerId,
          )) ?? connection
        if (latest.oauthClientId) return latest

        const registered = await callProvider(
          () =>
            provider.registerClient?.({
              configuration: latest.configuration,
              redirectUri,
              clientMetadataUrl,
            }),
          'client_registration_failed',
        )
        if (!registered) {
          throw new BrokerError(
            500,
            'client_registration_failed',
            'The MCP provider did not return client credentials.',
          )
        }
        const updated = await db.updateConnection(latest.id, {
          oauthIssuer: registered.issuer ?? null,
          oauthClientId: registered.clientId,
          oauthClientSecret: registered.clientSecret
            ? await encryptSecret(
                requireEncryptionKey(env),
                registered.clientSecret,
              )
            : null,
        })
        if (!updated)
          throw new Error('Connection disappeared during provisioning.')
        return updated
      })().finally(() => provisioningLocks.delete(lockKey))
      provisioningLocks.set(lockKey, pending)
    }
    prepared = await pending
  }

  const clientSecret = prepared.oauthClientSecret
    ? await decryptSecret(requireEncryptionKey(env), prepared.oauthClientSecret)
    : ''
  return {
    connection: prepared,
    provider: provider.createProvider(
      { clientId: prepared.oauthClientId!, clientSecret },
      prepared.configuration,
    ),
  }
}

export type StartAuthorizationResult = {
  authorizeUrl: string
  expiresAt: Date
  connection: Connection
}

export async function startAuthorization(
  db: Database,
  env: object,
  input: {
    connection: Connection
    redirectUri: string
    clientMetadataUrl: string
    returnTo?: string
    scopes?: string[]
  },
  providers: BoundProviderSource = defaultBoundProviderSource,
): Promise<StartAuthorizationResult> {
  const configured = await configureOAuthProvider(
    db,
    env,
    input.connection,
    providers,
    input.redirectUri,
    input.clientMetadataUrl,
  )
  const scopes = input.scopes?.length
    ? input.scopes
    : [...(configured.provider.defaultScopes ?? [])]
  const state = await createAuthorizationState(
    env,
    configured.connection.organization || undefined,
  )
  const stateHash = await hashToken(state)
  const expiresAt = new Date(Date.now() + STATE_TTL_MS)
  const authorization = await callProvider(() =>
    configured.provider.createAuthorization({
      redirectUri: input.redirectUri,
      state,
      scopes,
    }),
  )

  await db.supersedeOAuthStates(
    configured.connection.organization,
    configured.connection.namespace,
    configured.connection.providerId,
  )
  await db.createOAuthState({
    id: stateHash,
    organization: configured.connection.organization,
    namespace: configured.connection.namespace,
    providerId: configured.connection.providerId,
    codeVerifier: authorization.codeVerifier,
    redirectUri: input.redirectUri,
    returnTo: input.returnTo,
    scopes,
    issuer: configured.connection.oauthIssuer ?? undefined,
    expiresAt,
  })

  return {
    authorizeUrl: authorization.url,
    expiresAt,
    connection: configured.connection,
  }
}

type StoredCredentialFields = Pick<
  Connection,
  | 'secret'
  | 'refreshToken'
  | 'tokenType'
  | 'scopes'
  | 'expiresAt'
  | 'metadata'
  | 'externalAccountId'
  | 'externalAccountLabel'
>

async function toStoredFields(
  env: object,
  response: ProviderTokenResponse,
  fallbackScopes: string[],
  previousRefreshToken?: string | null,
): Promise<StoredCredentialFields> {
  const parsed = tokenResponseSchema.parse(response.payload)
  const scopes = parseScopeValue(parsed.scope)
  const refreshToken = parsed.refresh_token ?? previousRefreshToken ?? null
  const metadata: Record<string, unknown> = { ...response.payload }
  delete metadata.access_token
  delete metadata.refresh_token
  delete metadata.id_token

  return {
    secret: await encryptSecret(requireEncryptionKey(env), parsed.access_token),
    refreshToken: refreshToken
      ? await encryptSecret(requireEncryptionKey(env), refreshToken)
      : null,
    tokenType: parsed.token_type ?? 'Bearer',
    scopes: scopes.length > 0 ? scopes : fallbackScopes,
    expiresAt: parsed.expires_in
      ? new Date(Date.now() + parsed.expires_in * 1000)
      : null,
    metadata,
    externalAccountId: response.account?.id ?? null,
    externalAccountLabel: response.account?.label ?? null,
  }
}

function storedErrorStatus(status: number | null): ContentfulStatusCode {
  switch (status) {
    case 400:
    case 401:
    case 403:
    case 404:
    case 409:
    case 500:
    case 502:
      return status
    default:
      return 400
  }
}

export async function completeAuthorization(
  db: Database,
  env: object,
  input: {
    providerId: string
    code: string
    state: string
    issuer?: string
    clientMetadataUrl: string
  },
  providers: BoundProviderSource = defaultBoundProviderSource,
): Promise<{ connection: Connection; state: OAuthState; replayed: boolean }> {
  const stateHash = await hashToken(input.state)
  const stateIds = [stateHash, input.state]
  const pending = await db.claimOAuthState(stateIds, input.providerId)

  if (!pending) {
    const existing = await db.getOAuthState(stateIds, input.providerId)
    if (!existing) {
      throw new BrokerError(
        400,
        'invalid_state',
        'Authorization state is unknown.',
      )
    }
    if (existing.status === 'completed') {
      const connection = await db.getConnection(
        existing.organization,
        existing.namespace,
        existing.providerId,
      )
      if (!connection)
        throw new BrokerError(
          404,
          'connection_not_found',
          'Connection not found.',
        )
      return { connection, state: existing, replayed: true }
    }
    throw new BrokerError(
      storedErrorStatus(existing.errorStatus),
      existing.errorCode ?? 'authorization_failed',
      existing.errorMessage ?? 'Authorization failed. Start the flow again.',
    )
  }

  if (pending.expiresAt.getTime() < Date.now()) {
    const error = new BrokerError(
      400,
      'expired_state',
      'Authorization state expired.',
    )
    await markAuthorizationFailed(db, pending.id, error)
    throw error
  }

  try {
    if (pending.issuer && input.issuer && pending.issuer !== input.issuer) {
      throw new BrokerError(
        400,
        'issuer_mismatch',
        'The authorization response issuer does not match the discovered authorization server.',
      )
    }
    const connection = await db.getConnection(
      pending.organization,
      pending.namespace,
      pending.providerId,
    )
    if (!connection) {
      throw new BrokerError(
        404,
        'connection_not_found',
        'Connection not found.',
      )
    }
    const configured = await configureOAuthProvider(
      db,
      env,
      connection,
      providers,
      pending.redirectUri,
      input.clientMetadataUrl,
    )
    const response = await callProvider(() =>
      configured.provider.exchangeCode({
        code: input.code,
        redirectUri: pending.redirectUri,
        codeVerifier: pending.codeVerifier ?? undefined,
        issuer: input.issuer,
      }),
    )
    const updated = await db.updateConnection(
      configured.connection.id,
      await toStoredFields(env, response, pending.scopes),
    )
    if (!updated)
      throw new BrokerError(
        404,
        'connection_not_found',
        'Connection not found.',
      )
    const completed = await db.updateOAuthState(pending.id, {
      status: 'completed',
      completedAt: new Date(),
    })
    return { connection: updated, state: completed ?? pending, replayed: false }
  } catch (error) {
    await markAuthorizationFailed(db, pending.id, error)
    throw error
  }
}

async function markAuthorizationFailed(
  db: Database,
  stateId: string,
  error: unknown,
): Promise<void> {
  const brokerError =
    error instanceof BrokerError
      ? error
      : new BrokerError(500, 'internal_error', 'Unexpected broker error.')
  await db.updateOAuthState(stateId, {
    status: 'failed',
    errorStatus: brokerError.status,
    errorCode: brokerError.code,
    errorMessage: brokerError.message,
    completedAt: new Date(),
  })
}

export async function failAuthorization(
  db: Database,
  input: {
    providerId: string
    state: string
    errorCode: string
    errorMessage: string
  },
): Promise<{ state: OAuthState; replayed: boolean }> {
  const stateHash = await hashToken(input.state)
  const stateIds = [stateHash, input.state]
  const pending = await db.claimOAuthState(stateIds, input.providerId)
  const failed = pending
    ? await db.updateOAuthState(pending.id, {
        status: 'failed',
        errorStatus: 400,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        completedAt: new Date(),
      })
    : undefined
  if (failed) return { state: failed, replayed: false }
  const existing = await db.getOAuthState(stateIds, input.providerId)
  if (!existing)
    throw new BrokerError(
      400,
      'invalid_state',
      'Authorization state is unknown.',
    )
  if (existing.status === 'failed') return { state: existing, replayed: true }
  throw new BrokerError(
    409,
    'callback_in_progress',
    'Authorization callback is already being processed.',
  )
}

export async function getAuthorizationState(
  db: Database,
  providerId: string,
  state: string,
): Promise<OAuthState | undefined> {
  const stateHash = await hashToken(state)
  return db.getOAuthState([stateHash, state], providerId)
}

function isExpired(connection: Connection): boolean {
  return Boolean(
    connection.expiresAt &&
      connection.expiresAt.getTime() - REFRESH_LEEWAY_MS <= Date.now(),
  )
}

async function refreshConnection(
  db: Database,
  env: object,
  connection: Connection,
  providers: BoundProviderSource,
  redirectUri: string,
  clientMetadataUrl: string,
): Promise<Connection> {
  const configured = await configureOAuthProvider(
    db,
    env,
    connection,
    providers,
    redirectUri,
    clientMetadataUrl,
  )
  if (!connection.refreshToken || !configured.provider.refreshToken) {
    throw new BrokerError(
      401,
      'reauthorization_required',
      'Authorization is required again.',
    )
  }
  const refreshToken = await decryptSecret(
    requireEncryptionKey(env),
    connection.refreshToken,
  )
  const response = await callProvider(
    () => configured.provider.refreshToken?.({ refreshToken }),
    'reauthorization_required',
  )
  if (!response)
    throw new BrokerError(
      401,
      'reauthorization_required',
      'Authorization is required again.',
    )
  const updated = await db.updateConnection(
    connection.id,
    await toStoredFields(env, response, connection.scopes, refreshToken),
  )
  if (!updated)
    throw new BrokerError(404, 'connection_not_found', 'Connection not found.')
  return updated
}

export type AccessConnectionResult = {
  path: string
  secret: string
  expiresAt: Date | null
  scopes: string[]
  refreshed: boolean
}

function includesRequestedScopes(
  grantedScopes: readonly string[],
  requestedScopes: readonly string[] | undefined,
): boolean {
  if (!requestedScopes) return true
  const granted = new Set(grantedScopes)
  return requestedScopes.every((scope) => granted.has(scope))
}

export async function accessConnection(
  db: Database,
  env: object,
  input: {
    organization?: string
    namespace: string
    providerId: string
    configuration?: Record<string, unknown>
    redirectUri: string
    clientMetadataUrl: string
    returnTo?: string
    scopes?: string[]
  },
  providers: BoundProviderSource = defaultBoundProviderSource,
): Promise<AccessConnectionResult> {
  let connection = await ensureConnection(db, input, providers)
  const provider = await getProvider(providers, input.providerId)
  if (isSecretProvider(provider)) {
    if (!connection.secret) {
      throw new BrokerError(
        404,
        'secret_required',
        `Connection "${formatConnectionPath(input.namespace, input.providerId)}" needs a secret.`,
      )
    }
    return {
      path: formatConnectionPath(input.namespace, input.providerId),
      secret: await decryptSecret(requireEncryptionKey(env), connection.secret),
      expiresAt: null,
      scopes: [],
      refreshed: false,
    }
  }

  let refreshed = false
  if (connection.secret && isExpired(connection)) {
    try {
      connection = await refreshConnection(
        db,
        env,
        connection,
        providers,
        input.redirectUri,
        input.clientMetadataUrl,
      )
      refreshed = true
    } catch (error) {
      if (
        !(error instanceof BrokerError) ||
        error.code !== 'reauthorization_required'
      )
        throw error
    }
  }

  if (
    !connection.secret ||
    isExpired(connection) ||
    !includesRequestedScopes(connection.scopes, input.scopes)
  ) {
    const authorization = await startAuthorization(
      db,
      env,
      {
        connection,
        redirectUri: input.redirectUri,
        clientMetadataUrl: input.clientMetadataUrl,
        returnTo: input.returnTo,
        scopes: input.scopes,
      },
      providers,
    )
    throw new BrokerError(
      401,
      'authorization_required',
      `Connection "${formatConnectionPath(input.namespace, input.providerId)}" requires authorization.`,
      {
        authorize_url: authorization.authorizeUrl,
        expires_at: authorization.expiresAt.toISOString(),
      },
    )
  }

  return {
    path: formatConnectionPath(input.namespace, input.providerId),
    secret: await decryptSecret(requireEncryptionKey(env), connection.secret),
    expiresAt: connection.expiresAt,
    scopes: connection.scopes,
    refreshed,
  }
}

export async function authorizeConnection(
  db: Database,
  env: object,
  input: {
    organization?: string
    namespace: string
    providerId: string
    configuration?: Record<string, unknown>
    redirectUri: string
    clientMetadataUrl: string
    returnTo?: string
    scopes?: string[]
  },
  providers: BoundProviderSource = defaultBoundProviderSource,
): Promise<never> {
  const connection = await ensureConnection(db, input, providers)
  const provider = await getProvider(providers, input.providerId)
  if (isSecretProvider(provider)) {
    throw new BrokerError(
      400,
      'connection_option_unsupported',
      'Static-secret connections do not support authorization.',
    )
  }

  const authorization = await startAuthorization(
    db,
    env,
    {
      connection,
      redirectUri: input.redirectUri,
      clientMetadataUrl: input.clientMetadataUrl,
      returnTo: input.returnTo,
      scopes: input.scopes,
    },
    providers,
  )
  throw new BrokerError(
    401,
    'authorization_required',
    `Connection "${formatConnectionPath(input.namespace, input.providerId)}" requires authorization.`,
    {
      authorize_url: authorization.authorizeUrl,
      expires_at: authorization.expiresAt.toISOString(),
    },
  )
}

export async function setConnectionSecret(
  db: Database,
  env: object,
  input: {
    organization?: string
    namespace: string
    providerId: string
    value: string
  },
  providers: BoundProviderSource = defaultBoundProviderSource,
): Promise<Connection> {
  const provider = await getProvider(providers, input.providerId)
  if (!isSecretProvider(provider)) {
    throw new BrokerError(
      409,
      'secret_assignment_unsupported',
      `Provider "${input.providerId}" does not accept a caller-supplied secret.`,
    )
  }
  const connection = await ensureConnection(db, input, providers)
  const updated = await db.updateConnection(connection.id, {
    secret: await encryptSecret(requireEncryptionKey(env), input.value),
  })
  if (!updated)
    throw new BrokerError(404, 'connection_not_found', 'Connection not found.')
  return updated
}

export async function disconnectConnection(
  db: Database,
  env: object,
  connection: Connection,
  providers: BoundProviderSource = defaultBoundProviderSource,
  redirectUri = '',
  clientMetadataUrl = '',
): Promise<{ deleted: boolean; revocation: 'revoked' | 'unsupported' }> {
  const provider = await getProvider(providers, connection.providerId)
  let revocation: 'revoked' | 'unsupported' = 'unsupported'
  if (!isSecretProvider(provider) && connection.secret) {
    const configured = await configureOAuthProvider(
      db,
      env,
      connection,
      providers,
      redirectUri,
      clientMetadataUrl,
    )
    if (configured.provider.revokeToken) {
      const key = requireEncryptionKey(env)
      const accessToken = await decryptSecret(key, connection.secret)
      const refreshToken = connection.refreshToken
        ? await decryptSecret(key, connection.refreshToken)
        : undefined
      await callProvider(
        () =>
          configured.provider.revokeToken?.({
            accessToken,
            refreshToken,
          }),
        'token_revocation_failed',
      )
      revocation = 'revoked'
    }
  }
  return { deleted: await db.deleteConnection(connection.id), revocation }
}
