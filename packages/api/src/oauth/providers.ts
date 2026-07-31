import { and, eq, sql } from 'drizzle-orm'
import {
  type Database,
  type OAuthProvider,
  oauthConnections,
  oauthProviders,
} from '../db/schema'
import { encryptSecret } from './crypto'
import { BrokerError } from './errors'

/** Subset of broker env needed for provider credential crypto / env bootstrap. */
type ProviderEnv = {
  OAUTH_ENCRYPTION_KEY?: string
  [key: string]: unknown
}

/**
 * Everything the broker needs to know about a provider that is *not* a secret.
 * Credentials live encrypted on the `oauth_providers` row.
 *
 * To add a provider, `POST /api/oauth/providers` (or seed a row). Nothing else
 * in the codebase needs to change.
 */
export type ProviderDefinition = {
  id: string
  label: string
  authorizeUrl: string
  tokenUrl: string
  defaultScopes: string[]
  /** Google/GitHub use spaces; Linear uses commas. */
  scopeSeparator: string
  /** How the token endpoint wants the request encoded. */
  tokenRequestFormat: 'form' | 'json'
  /** Basic-auth header vs. client_id/client_secret in the body. */
  clientAuth: 'basic' | 'body'
  /** Whether to run the PKCE S256 challenge. */
  usePkce: boolean
  /** Whether the provider issues refresh tokens worth attempting to use. */
  supportsRefresh: boolean
  /** Static params appended to the authorize URL. */
  authorizeParams: Record<string, string>
  /** Top-level token-response field used as external_account_id. */
  accountIdField?: string
  /** Top-level token-response field used as external_account_label. */
  accountLabelField?: string
}

export type ProviderWriteInput = {
  id: string
  label: string
  authorizeUrl: string
  tokenUrl: string
  defaultScopes?: string[]
  scopeSeparator?: string
  tokenRequestFormat?: 'form' | 'json'
  clientAuth?: 'basic' | 'body'
  usePkce?: boolean
  supportsRefresh?: boolean
  authorizeParams?: Record<string, string>
  accountIdField?: string | null
  accountLabelField?: string | null
  clientId?: string
  clientSecret?: string
  enabled?: boolean
}

export type ProviderPatchInput = {
  label?: string
  authorizeUrl?: string
  tokenUrl?: string
  defaultScopes?: string[]
  scopeSeparator?: string
  tokenRequestFormat?: 'form' | 'json'
  clientAuth?: 'basic' | 'body'
  usePkce?: boolean
  supportsRefresh?: boolean
  authorizeParams?: Record<string, string>
  accountIdField?: string | null
  accountLabelField?: string | null
  clientId?: string
  clientSecret?: string
  enabled?: boolean
}

function asTokenRequestFormat(value: string): 'form' | 'json' {
  if (value === 'form' || value === 'json') return value
  throw new BrokerError(
    500,
    'invalid_provider',
    `Provider token_request_format must be "form" or "json", got "${value}".`,
  )
}

function asClientAuth(value: string): 'basic' | 'body' {
  if (value === 'basic' || value === 'body') return value
  throw new BrokerError(
    500,
    'invalid_provider',
    `Provider client_auth must be "basic" or "body", got "${value}".`,
  )
}

export function rowToDefinition(row: OAuthProvider): ProviderDefinition {
  return {
    id: row.id,
    label: row.label,
    authorizeUrl: row.authorizeUrl,
    tokenUrl: row.tokenUrl,
    defaultScopes: row.defaultScopes,
    scopeSeparator: row.scopeSeparator,
    tokenRequestFormat: asTokenRequestFormat(row.tokenRequestFormat),
    clientAuth: asClientAuth(row.clientAuth),
    usePkce: row.usePkce,
    supportsRefresh: row.supportsRefresh,
    authorizeParams: row.authorizeParams ?? {},
    accountIdField: row.accountIdField ?? undefined,
    accountLabelField: row.accountLabelField ?? undefined,
  }
}

/** True when both halves of the provider's credentials are stored. */
export function isProviderRowConfigured(row: OAuthProvider): boolean {
  return (
    typeof row.clientIdEncrypted === 'string' &&
    row.clientIdEncrypted.length > 0 &&
    typeof row.clientSecretEncrypted === 'string' &&
    row.clientSecretEncrypted.length > 0
  )
}

export function describeAccountFromFields(
  definition: ProviderDefinition,
  payload: Record<string, unknown>,
): { id?: string; label?: string } {
  const id =
    definition.accountIdField &&
    typeof payload[definition.accountIdField] === 'string'
      ? (payload[definition.accountIdField] as string)
      : undefined
  const label =
    definition.accountLabelField &&
    typeof payload[definition.accountLabelField] === 'string'
      ? (payload[definition.accountLabelField] as string)
      : undefined

  return { id, label }
}

export async function listProviderRows(
  db: Database,
  options: { includeDisabled?: boolean } = {},
): Promise<OAuthProvider[]> {
  if (options.includeDisabled) {
    return db.select().from(oauthProviders).orderBy(oauthProviders.id)
  }

  return db
    .select()
    .from(oauthProviders)
    .where(eq(oauthProviders.enabled, true))
    .orderBy(oauthProviders.id)
}

export async function getProviderRow(
  db: Database,
  providerId: string,
  options: { requireEnabled?: boolean } = {},
): Promise<OAuthProvider | undefined> {
  const requireEnabled = options.requireEnabled ?? false
  const [row] = await db
    .select()
    .from(oauthProviders)
    .where(
      requireEnabled
        ? and(
            eq(oauthProviders.id, providerId),
            eq(oauthProviders.enabled, true),
          )
        : eq(oauthProviders.id, providerId),
    )
    .limit(1)

  return row
}

export async function requireProviderRow(
  db: Database,
  providerId: string,
  options: { requireEnabled?: boolean } = {},
): Promise<OAuthProvider> {
  const row = await getProviderRow(db, providerId, options)

  if (!row) {
    const known = (await listProviderRows(db, { includeDisabled: true })).map(
      (p) => p.id,
    )
    throw new BrokerError(
      404,
      'unknown_provider',
      `Unknown provider "${providerId}". Known providers: ${known.join(', ') || '(none)'}.`,
    )
  }

  return row
}

async function requireEncryptionKey(env: ProviderEnv): Promise<string> {
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

export async function createProvider(
  db: Database,
  env: ProviderEnv,
  input: ProviderWriteInput,
): Promise<OAuthProvider> {
  const existing = await getProviderRow(db, input.id)
  if (existing) {
    throw new BrokerError(
      409,
      'provider_exists',
      `Provider "${input.id}" already exists.`,
    )
  }

  const encryptionKey = await requireEncryptionKey(env)
  const clientIdEncrypted = input.clientId
    ? await encryptSecret(encryptionKey, input.clientId)
    : null
  const clientSecretEncrypted = input.clientSecret
    ? await encryptSecret(encryptionKey, input.clientSecret)
    : null

  if (
    (clientIdEncrypted && !clientSecretEncrypted) ||
    (!clientIdEncrypted && clientSecretEncrypted)
  ) {
    throw new BrokerError(
      400,
      'invalid_request',
      'Provide both client_id and client_secret, or neither.',
    )
  }

  const [row] = await db
    .insert(oauthProviders)
    .values({
      id: input.id,
      label: input.label,
      authorizeUrl: input.authorizeUrl,
      tokenUrl: input.tokenUrl,
      defaultScopes: input.defaultScopes ?? [],
      scopeSeparator: input.scopeSeparator ?? ' ',
      tokenRequestFormat: input.tokenRequestFormat ?? 'form',
      clientAuth: input.clientAuth ?? 'body',
      usePkce: input.usePkce ?? false,
      supportsRefresh: input.supportsRefresh ?? true,
      authorizeParams: input.authorizeParams ?? {},
      accountIdField: input.accountIdField ?? null,
      accountLabelField: input.accountLabelField ?? null,
      clientIdEncrypted,
      clientSecretEncrypted,
      enabled: input.enabled ?? true,
    })
    .returning()

  return row
}

export async function updateProvider(
  db: Database,
  env: ProviderEnv,
  providerId: string,
  input: ProviderPatchInput,
): Promise<OAuthProvider> {
  await requireProviderRow(db, providerId)

  if (
    (input.clientId !== undefined && input.clientSecret === undefined) ||
    (input.clientId === undefined && input.clientSecret !== undefined)
  ) {
    throw new BrokerError(
      400,
      'invalid_request',
      'Provide both client_id and client_secret when updating credentials.',
    )
  }

  const patch: Partial<typeof oauthProviders.$inferInsert> = {
    updatedAt: new Date(),
  }

  if (input.label !== undefined) patch.label = input.label
  if (input.authorizeUrl !== undefined) patch.authorizeUrl = input.authorizeUrl
  if (input.tokenUrl !== undefined) patch.tokenUrl = input.tokenUrl
  if (input.defaultScopes !== undefined)
    patch.defaultScopes = input.defaultScopes
  if (input.scopeSeparator !== undefined) {
    patch.scopeSeparator = input.scopeSeparator
  }
  if (input.tokenRequestFormat !== undefined) {
    patch.tokenRequestFormat = input.tokenRequestFormat
  }
  if (input.clientAuth !== undefined) patch.clientAuth = input.clientAuth
  if (input.usePkce !== undefined) patch.usePkce = input.usePkce
  if (input.supportsRefresh !== undefined) {
    patch.supportsRefresh = input.supportsRefresh
  }
  if (input.authorizeParams !== undefined) {
    patch.authorizeParams = input.authorizeParams
  }
  if (input.accountIdField !== undefined) {
    patch.accountIdField = input.accountIdField
  }
  if (input.accountLabelField !== undefined) {
    patch.accountLabelField = input.accountLabelField
  }
  if (input.enabled !== undefined) patch.enabled = input.enabled

  if (input.clientId !== undefined && input.clientSecret !== undefined) {
    const encryptionKey = await requireEncryptionKey(env)
    patch.clientIdEncrypted = await encryptSecret(encryptionKey, input.clientId)
    patch.clientSecretEncrypted = await encryptSecret(
      encryptionKey,
      input.clientSecret,
    )
  }

  const [row] = await db
    .update(oauthProviders)
    .set(patch)
    .where(eq(oauthProviders.id, providerId))
    .returning()

  return row
}

export async function deleteProvider(
  db: Database,
  providerId: string,
): Promise<void> {
  await requireProviderRow(db, providerId)

  const [usage] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(oauthConnections)
    .where(eq(oauthConnections.provider, providerId))

  if ((usage?.count ?? 0) > 0) {
    throw new BrokerError(
      409,
      'provider_in_use',
      `Provider "${providerId}" still has ${usage.count} connection(s). Delete them first.`,
    )
  }

  await db.delete(oauthProviders).where(eq(oauthProviders.id, providerId))
}

/**
 * One-time cutover helper for local Node: if a seeded row has no credentials
 * but matching `<ID>_CLIENT_ID` / `_SECRET` env vars exist, encrypt and store
 * them. Env is never read by the OAuth resolve path after this.
 */
export async function bootstrapProviderCredentialsFromEnv(
  db: Database,
  env: ProviderEnv,
): Promise<string[]> {
  const encryptionKey =
    typeof env.OAUTH_ENCRYPTION_KEY === 'string'
      ? env.OAUTH_ENCRYPTION_KEY.trim()
      : ''

  if (!encryptionKey) return []

  const rows = await listProviderRows(db, { includeDisabled: true })
  const bootstrapped: string[] = []

  for (const row of rows) {
    if (isProviderRowConfigured(row)) continue

    const prefix = row.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')
    const clientId = readPlainEnv(env, `${prefix}_CLIENT_ID`)
    const clientSecret = readPlainEnv(env, `${prefix}_CLIENT_SECRET`)

    if (!clientId || !clientSecret) continue

    await db
      .update(oauthProviders)
      .set({
        clientIdEncrypted: await encryptSecret(encryptionKey, clientId),
        clientSecretEncrypted: await encryptSecret(encryptionKey, clientSecret),
        updatedAt: new Date(),
      })
      .where(eq(oauthProviders.id, row.id))

    bootstrapped.push(row.id)
  }

  return bootstrapped
}

function readPlainEnv(env: ProviderEnv, key: string): string | undefined {
  const value = env[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export async function listConfiguredProviderIds(
  db: Database,
): Promise<string[]> {
  const rows = await listProviderRows(db)
  return rows.filter(isProviderRowConfigured).map((row) => row.id)
}
