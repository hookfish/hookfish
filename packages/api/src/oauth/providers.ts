import { eq } from 'drizzle-orm'
import { z } from '@hono/zod-openapi'
import {
  type OAuthProvider,
  oauthConnections,
  oauthProviders,
  oauthStates,
} from '../db/schema'
import type { Database } from '../db/types'
import { decryptSecret, encryptSecret } from './crypto'
import { BrokerError } from './errors'

/**
 * Everything the broker needs to know about a provider's OAuth dialect.
 * Rows live in `oauth_providers` and are managed entirely over the API.
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
  authorizeParams?: Record<string, string>
  /** Dot-paths into the token response for a stable account identity. */
  accountIdPath?: string | null
  accountLabelPath?: string | null
}

export const providerIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z][a-z0-9_-]*$/,
    'Provider id must be lowercase alphanumeric, starting with a letter (may include - and _).',
  )

export const tokenRequestFormatSchema = z.enum(['form', 'json'])
export const clientAuthSchema = z.enum(['basic', 'body'])

const stringField = z.string().optional().catch(undefined)

/** Resolve a dotted path like `workspace_id` or `user.email` on a plain object. */
export function readPath(
  payload: Record<string, unknown>,
  path: string | null | undefined,
): string | undefined {
  if (!path) return undefined

  const segments = path.split('.').filter((segment) => segment.length > 0)
  let current: unknown = payload

  for (const segment of segments) {
    if (typeof current !== 'object' || current === null) return undefined
    current = Reflect.get(current, segment)
  }

  return stringField.parse(current)
}

export function describeAccount(
  definition: ProviderDefinition,
  payload: Record<string, unknown>,
): { id?: string; label?: string } {
  return {
    id: readPath(payload, definition.accountIdPath),
    label: readPath(payload, definition.accountLabelPath),
  }
}

function asTokenRequestFormat(value: string): 'form' | 'json' {
  return tokenRequestFormatSchema.parse(value)
}

function asClientAuth(value: string): 'basic' | 'body' {
  return clientAuthSchema.parse(value)
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
    authorizeParams:
      Object.keys(row.authorizeParams).length > 0
        ? row.authorizeParams
        : undefined,
    accountIdPath: row.accountIdPath,
    accountLabelPath: row.accountLabelPath,
  }
}

/** Public shape -- never includes credentials. */
export function serializeProvider(row: OAuthProvider) {
  return {
    id: row.id,
    label: row.label,
    authorize_url: row.authorizeUrl,
    token_url: row.tokenUrl,
    default_scopes: row.defaultScopes,
    scope_separator: row.scopeSeparator,
    token_request_format: asTokenRequestFormat(row.tokenRequestFormat),
    client_auth: asClientAuth(row.clientAuth),
    use_pkce: row.usePkce,
    supports_refresh: row.supportsRefresh,
    authorize_params: row.authorizeParams,
    account_id_path: row.accountIdPath,
    account_label_path: row.accountLabelPath,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  }
}

export async function listProviderRows(db: Database): Promise<OAuthProvider[]> {
  return db.select().from(oauthProviders).orderBy(oauthProviders.id)
}

export async function findProviderRow(
  db: Database,
  providerId: string,
): Promise<OAuthProvider | undefined> {
  const [row] = await db
    .select()
    .from(oauthProviders)
    .where(eq(oauthProviders.id, providerId))
    .limit(1)

  return row
}

export type CreateProviderInput = {
  id: string
  label: string
  authorizeUrl: string
  tokenUrl: string
  clientId: string
  clientSecret: string
  defaultScopes?: string[]
  scopeSeparator?: string
  tokenRequestFormat?: 'form' | 'json'
  clientAuth?: 'basic' | 'body'
  usePkce?: boolean
  supportsRefresh?: boolean
  authorizeParams?: Record<string, string>
  accountIdPath?: string | null
  accountLabelPath?: string | null
}

export async function createProvider(
  db: Database,
  encryptionKey: string,
  input: CreateProviderInput,
): Promise<OAuthProvider> {
  const existing = await findProviderRow(db, input.id)

  if (existing) {
    throw new BrokerError(
      409,
      'provider_exists',
      `Provider "${input.id}" already exists. PATCH /api/oauth/providers/${input.id} to update it.`,
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
      accountIdPath: input.accountIdPath ?? null,
      accountLabelPath: input.accountLabelPath ?? null,
      clientIdEncrypted: await encryptSecret(encryptionKey, input.clientId),
      clientSecretEncrypted: await encryptSecret(
        encryptionKey,
        input.clientSecret,
      ),
    })
    .returning()

  return row
}

export type UpdateProviderInput = {
  label?: string
  authorizeUrl?: string
  tokenUrl?: string
  clientId?: string
  clientSecret?: string
  defaultScopes?: string[]
  scopeSeparator?: string
  tokenRequestFormat?: 'form' | 'json'
  clientAuth?: 'basic' | 'body'
  usePkce?: boolean
  supportsRefresh?: boolean
  authorizeParams?: Record<string, string>
  accountIdPath?: string | null
  accountLabelPath?: string | null
}

export async function updateProvider(
  db: Database,
  encryptionKey: string,
  providerId: string,
  input: UpdateProviderInput,
): Promise<OAuthProvider> {
  const existing = await findProviderRow(db, providerId)

  if (!existing) {
    throw new BrokerError(
      404,
      'unknown_provider',
      `Unknown provider "${providerId}". Create it with POST /api/oauth/providers.`,
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
  if (input.scopeSeparator !== undefined)
    patch.scopeSeparator = input.scopeSeparator
  if (input.tokenRequestFormat !== undefined)
    patch.tokenRequestFormat = input.tokenRequestFormat
  if (input.clientAuth !== undefined) patch.clientAuth = input.clientAuth
  if (input.usePkce !== undefined) patch.usePkce = input.usePkce
  if (input.supportsRefresh !== undefined)
    patch.supportsRefresh = input.supportsRefresh
  if (input.authorizeParams !== undefined)
    patch.authorizeParams = input.authorizeParams
  if (input.accountIdPath !== undefined)
    patch.accountIdPath = input.accountIdPath
  if (input.accountLabelPath !== undefined)
    patch.accountLabelPath = input.accountLabelPath
  if (input.clientId !== undefined) {
    patch.clientIdEncrypted = await encryptSecret(encryptionKey, input.clientId)
  }
  if (input.clientSecret !== undefined) {
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

/**
 * Removes the provider and any connections / in-flight states that reference
 * it, so authorize against a deleted id cannot succeed with stale secrets.
 */
export async function deleteProvider(
  db: Database,
  providerId: string,
): Promise<boolean> {
  const existing = await findProviderRow(db, providerId)
  if (!existing) return false

  await db
    .delete(oauthConnections)
    .where(eq(oauthConnections.provider, providerId))
  await db.delete(oauthStates).where(eq(oauthStates.provider, providerId))
  await db.delete(oauthProviders).where(eq(oauthProviders.id, providerId))

  return true
}

export async function resolveProviderCredentials(
  encryptionKey: string,
  row: OAuthProvider,
): Promise<{ clientId: string; clientSecret: string }> {
  return {
    clientId: await decryptSecret(encryptionKey, row.clientIdEncrypted),
    clientSecret: await decryptSecret(encryptionKey, row.clientSecretEncrypted),
  }
}
