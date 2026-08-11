import { DurableObject } from 'cloudflare:workers'
import {
  type BrokerAccessToken,
  type Database,
  type DatabaseContext,
  defineDatabase,
  type NewBrokerAccessToken,
  type NewOAuthConnection,
  type NewOAuthProviderRecord,
  type NewOAuthState,
  type NewVaultSecret,
  type OAuthConnection,
  type OAuthConnectionFilter,
  type OAuthConnectionSummary,
  type OAuthConnectionTokenUpdate,
  type OAuthProviderFilter,
  type OAuthProviderRecord,
  type OAuthProviderUpdate,
  type OAuthState,
  type OAuthStateUpdate,
  type VaultSecret,
  type VaultSecretFilter,
  type VaultSecretMetadata,
} from '@hookfish/api/database'

type OAuthStateRow = {
  id: string
  connection_id: string
  organization: string | null
  provider: string
  code_verifier: string | null
  redirect_uri: string
  return_to: string | null
  scopes: string
  status: string
  error_status: number | null
  error_code: string | null
  error_message: string | null
  completed_at: number | null
  created_at: number
  expires_at: number
}

type OAuthConnectionRow = {
  id: string
  organization: string | null
  connection_id: string
  provider: string
  access_token: string
  refresh_token: string | null
  token_type: string
  scopes: string
  expires_at: number | null
  metadata: string
  external_account_id: string | null
  external_account_label: string | null
  created_at: number
  updated_at: number
}

type OAuthProviderRow = {
  id: string
  organization: string
  provider_id: string
  template_id: string
  label: string | null
  credential_mode: string
  client_id: string | null
  client_secret_path: string | null
  configuration: string
  enabled: number
  created_at: number
  updated_at: number
}

type VaultSecretRow = {
  id: string
  organization: string
  path: string
  value: string
  created_at: number
  updated_at: number
}

type BrokerAccessTokenRow = {
  name: string
  token_id_hash: string
  scopes: string
  created_at: number
  expires_at: number
}

function decodeStringArray(value: string): string[] {
  const decoded: unknown = JSON.parse(value)
  return Array.isArray(decoded)
    ? decoded.filter((item): item is string => typeof item === 'string')
    : []
}

function decodeObject(value: string): Record<string, unknown> {
  const decoded: unknown = JSON.parse(value)
  return typeof decoded === 'object' &&
    decoded !== null &&
    !Array.isArray(decoded)
    ? Object.fromEntries(Object.entries(decoded))
    : {}
}

function toOAuthState(row: OAuthStateRow): OAuthState {
  return {
    id: row.id,
    connectionId: row.connection_id,
    organization: row.organization,
    provider: row.provider,
    codeVerifier: row.code_verifier,
    redirectUri: row.redirect_uri,
    returnTo: row.return_to,
    scopes: decodeStringArray(row.scopes),
    status: row.status,
    errorStatus: row.error_status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    completedAt: row.completed_at === null ? null : new Date(row.completed_at),
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
  }
}

function toOAuthConnection(row: OAuthConnectionRow): OAuthConnection {
  return {
    id: row.id,
    organization: row.organization,
    connectionId: row.connection_id,
    provider: row.provider,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    tokenType: row.token_type,
    scopes: decodeStringArray(row.scopes),
    expiresAt: row.expires_at === null ? null : new Date(row.expires_at),
    metadata: decodeObject(row.metadata),
    externalAccountId: row.external_account_id,
    externalAccountLabel: row.external_account_label,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

function toOAuthProvider(row: OAuthProviderRow): OAuthProviderRecord {
  return {
    id: row.id,
    organization: row.organization,
    providerId: row.provider_id,
    templateId: row.template_id,
    label: row.label,
    credentialMode: row.credential_mode,
    clientId: row.client_id,
    clientSecretPath: row.client_secret_path,
    configuration: decodeObject(row.configuration),
    enabled: row.enabled !== 0,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

function toVaultSecret(row: VaultSecretRow): VaultSecret {
  return {
    id: row.id,
    organization: row.organization,
    path: row.path,
    value: row.value,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

function toBrokerAccessToken(row: BrokerAccessTokenRow): BrokerAccessToken {
  return {
    name: row.name,
    tokenIdHash: row.token_id_hash,
    scopes: decodeStringArray(row.scopes),
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
  }
}

function connectionMatchesOrganization(
  connection: OAuthConnection,
  organization: string | undefined,
): boolean {
  if (!organization) return connection.organization === null
  return (
    connection.organization === organization ||
    (connection.organization === null &&
      (connection.connectionId === organization ||
        connection.connectionId.startsWith(`${organization}/`)))
  )
}

function pathMatchesScope(path: string, scope: string): boolean {
  const root = scope.endsWith('/**') ? scope.slice(0, -3) : scope
  return path === root || path.startsWith(`${root}/`)
}

function pathMatchesPrefix(path: string, prefix: string): boolean {
  return prefix.endsWith('/')
    ? path.startsWith(prefix)
    : pathMatchesScope(path, prefix)
}

/**
 * SQLite-backed Durable Object implementing the Hookfish persistence contract.
 * Export this class from the Worker entrypoint and configure it as a
 * `new_sqlite_class` in Wrangler.
 */
export class HookfishDurableObject<Env = object>
  extends DurableObject<Env>
  implements Database
{
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(() => {
      this.migrate()
      return Promise.resolve()
    })
  }

  private migrate(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS _hookfish_schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `)
    const current = this.ctx.storage.sql
      .exec<{ version: number }>(
        'SELECT COALESCE(MAX(version), 0) AS version FROM _hookfish_schema_migrations',
      )
      .one().version

    if (current < 1) {
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          `
          CREATE TABLE oauth_states (
            id TEXT PRIMARY KEY,
            connection_id TEXT NOT NULL,
            organization TEXT,
            provider TEXT NOT NULL,
            code_verifier TEXT,
            redirect_uri TEXT NOT NULL,
            return_to TEXT,
            scopes TEXT NOT NULL,
            status TEXT NOT NULL,
            error_status INTEGER,
            error_code TEXT,
            error_message TEXT,
            completed_at INTEGER,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
          );
          CREATE INDEX oauth_states_expires_idx ON oauth_states(expires_at);

          CREATE TABLE oauth_connections (
            id TEXT PRIMARY KEY,
            organization TEXT,
            connection_id TEXT NOT NULL UNIQUE,
            provider TEXT NOT NULL,
            access_token TEXT NOT NULL,
            refresh_token TEXT,
            token_type TEXT NOT NULL,
            scopes TEXT NOT NULL,
            expires_at INTEGER,
            metadata TEXT NOT NULL,
            external_account_id TEXT,
            external_account_label TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          );
          CREATE INDEX oauth_connections_organization_idx ON oauth_connections(organization);
          CREATE INDEX oauth_connections_provider_idx ON oauth_connections(provider);

          CREATE TABLE broker_access_tokens (
            name TEXT PRIMARY KEY,
            token_id_hash TEXT NOT NULL UNIQUE,
            scopes TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
          );
          CREATE INDEX broker_access_tokens_expires_idx ON broker_access_tokens(expires_at);

          CREATE TABLE oauth_providers (
            id TEXT PRIMARY KEY,
            organization TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            template_id TEXT NOT NULL,
            label TEXT,
            credential_mode TEXT NOT NULL,
            client_id TEXT,
            client_secret_path TEXT,
            configuration TEXT NOT NULL,
            enabled INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(organization, provider_id)
          );
          CREATE INDEX oauth_providers_organization_idx ON oauth_providers(organization);
          CREATE INDEX oauth_providers_template_id_idx ON oauth_providers(template_id);

          CREATE TABLE vault_secrets (
            id TEXT PRIMARY KEY,
            organization TEXT NOT NULL,
            path TEXT NOT NULL,
            value TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(organization, path)
          );
          CREATE INDEX vault_secrets_organization_idx ON vault_secrets(organization);

          INSERT INTO _hookfish_schema_migrations(version, applied_at)
          VALUES (1, ?);
        `,
          Date.now(),
        )
      })
    }
  }

  createOAuthState(input: NewOAuthState): void {
    const now = Date.now()
    this.ctx.storage.sql.exec(
      `INSERT INTO oauth_states (
        id, connection_id, organization, provider, code_verifier, redirect_uri,
        return_to, scopes, status, error_status, error_code, error_message,
        completed_at, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`,
      input.id,
      input.connectionId,
      input.organization ?? null,
      input.provider,
      input.codeVerifier ?? null,
      input.redirectUri,
      input.returnTo ?? null,
      JSON.stringify(input.scopes),
      input.status ?? 'pending',
      now,
      input.expiresAt.getTime(),
    )
  }

  claimOAuthState(
    ids: readonly string[],
    provider: string,
  ): OAuthState | undefined {
    if (ids.length === 0) return undefined
    const placeholders = ids.map(() => '?').join(', ')
    const rows = this.ctx.storage.sql
      .exec<OAuthStateRow>(
        `UPDATE oauth_states SET status = 'processing'
         WHERE id IN (${placeholders}) AND provider = ? AND status = 'pending'
         RETURNING *`,
        ...ids,
        provider,
      )
      .toArray()
    return rows[0] ? toOAuthState(rows[0]) : undefined
  }

  getOAuthState(
    ids: readonly string[],
    provider: string,
  ): OAuthState | undefined {
    if (ids.length === 0) return undefined
    const placeholders = ids.map(() => '?').join(', ')
    const rows = this.ctx.storage.sql
      .exec<OAuthStateRow>(
        `SELECT * FROM oauth_states
         WHERE id IN (${placeholders}) AND provider = ? LIMIT 1`,
        ...ids,
        provider,
      )
      .toArray()
    return rows[0] ? toOAuthState(rows[0]) : undefined
  }

  updateOAuthState(
    id: string,
    update: OAuthStateUpdate,
  ): OAuthState | undefined {
    const existing = this.ctx.storage.sql
      .exec<OAuthStateRow>(
        'SELECT * FROM oauth_states WHERE id = ? LIMIT 1',
        id,
      )
      .toArray()[0]
    if (!existing) return undefined
    const state = { ...toOAuthState(existing), ...update }
    const rows = this.ctx.storage.sql
      .exec<OAuthStateRow>(
        `UPDATE oauth_states SET
          status = ?, error_status = ?, error_code = ?, error_message = ?, completed_at = ?
         WHERE id = ? RETURNING *`,
        state.status,
        state.errorStatus,
        state.errorCode,
        state.errorMessage,
        state.completedAt?.getTime() ?? null,
        id,
      )
      .toArray()
    return rows[0] ? toOAuthState(rows[0]) : undefined
  }

  purgeExpiredOAuthStates(before: Date): number {
    return this.ctx.storage.sql.exec(
      'DELETE FROM oauth_states WHERE expires_at < ?',
      before.getTime(),
    ).rowsWritten
  }

  getOAuthConnection(
    connectionId: string,
    organization?: string,
  ): OAuthConnection | undefined {
    const rows = this.ctx.storage.sql
      .exec<OAuthConnectionRow>(
        'SELECT * FROM oauth_connections WHERE connection_id = ? LIMIT 1',
        connectionId,
      )
      .toArray()
    const connection = rows[0] ? toOAuthConnection(rows[0]) : undefined
    return connection && connectionMatchesOrganization(connection, organization)
      ? connection
      : undefined
  }

  upsertOAuthConnection(
    input: NewOAuthConnection,
  ): OAuthConnection | undefined {
    return this.ctx.storage.transactionSync(() => {
      const existingRow = this.ctx.storage.sql
        .exec<OAuthConnectionRow>(
          'SELECT * FROM oauth_connections WHERE connection_id = ? LIMIT 1',
          input.connectionId,
        )
        .toArray()[0]
      if (existingRow) {
        const existing = toOAuthConnection(existingRow)
        if (
          existing.provider !== input.provider ||
          !connectionMatchesOrganization(
            existing,
            input.organization ?? undefined,
          )
        ) {
          return undefined
        }
      }

      const now = Date.now()
      const id = existingRow?.id ?? crypto.randomUUID()
      this.ctx.storage.sql.exec(
        `INSERT INTO oauth_connections (
          id, organization, connection_id, provider, access_token, refresh_token,
          token_type, scopes, expires_at, metadata, external_account_id,
          external_account_label, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(connection_id) DO UPDATE SET
          organization = excluded.organization,
          access_token = excluded.access_token,
          refresh_token = excluded.refresh_token,
          token_type = excluded.token_type,
          scopes = excluded.scopes,
          expires_at = excluded.expires_at,
          metadata = excluded.metadata,
          external_account_id = excluded.external_account_id,
          external_account_label = excluded.external_account_label,
          updated_at = excluded.updated_at`,
        id,
        input.organization,
        input.connectionId,
        input.provider,
        input.accessToken,
        input.refreshToken,
        input.tokenType,
        JSON.stringify(input.scopes),
        input.expiresAt?.getTime() ?? null,
        JSON.stringify(input.metadata),
        input.externalAccountId,
        input.externalAccountLabel,
        existingRow?.created_at ?? now,
        now,
      )
      return this.getOAuthConnection(
        input.connectionId,
        input.organization ?? undefined,
      )
    })
  }

  updateOAuthConnectionTokens(
    id: string,
    update: OAuthConnectionTokenUpdate,
  ): OAuthConnection | undefined {
    const rows = this.ctx.storage.sql
      .exec<OAuthConnectionRow>(
        `UPDATE oauth_connections SET
          access_token = ?, refresh_token = ?, token_type = ?, scopes = ?,
          expires_at = ?, metadata = ?, external_account_id = ?,
          external_account_label = ?, updated_at = ?
         WHERE id = ? RETURNING *`,
        update.accessToken,
        update.refreshToken,
        update.tokenType,
        JSON.stringify(update.scopes),
        update.expiresAt?.getTime() ?? null,
        JSON.stringify(update.metadata),
        update.externalAccountId,
        update.externalAccountLabel,
        Date.now(),
        id,
      )
      .toArray()
    return rows[0] ? toOAuthConnection(rows[0]) : undefined
  }

  listOAuthConnections(
    filter: OAuthConnectionFilter = {},
  ): OAuthConnectionSummary[] {
    return this.ctx.storage.sql
      .exec<OAuthConnectionRow>('SELECT * FROM oauth_connections')
      .toArray()
      .map(toOAuthConnection)
      .filter(
        (connection) =>
          connectionMatchesOrganization(connection, filter.organization) &&
          (!filter.provider || connection.provider === filter.provider) &&
          (!filter.connectionIdPrefix ||
            pathMatchesPrefix(
              connection.connectionId,
              filter.connectionIdPrefix,
            )) &&
          (!filter.connectionScopes ||
            filter.connectionScopes.includes('**') ||
            filter.connectionScopes.some((scope) =>
              pathMatchesScope(connection.connectionId, scope),
            )),
      )
      .map(
        ({
          connectionId,
          provider,
          scopes,
          expiresAt,
          externalAccountId,
          externalAccountLabel,
          metadata,
          createdAt,
          updatedAt,
        }) => ({
          connectionId,
          provider,
          scopes,
          expiresAt,
          externalAccountId,
          externalAccountLabel,
          metadata,
          createdAt,
          updatedAt,
        }),
      )
  }

  deleteOAuthConnection(id: string): boolean {
    return (
      this.ctx.storage.sql.exec(
        'DELETE FROM oauth_connections WHERE id = ?',
        id,
      ).rowsWritten > 0
    )
  }

  hasOAuthConnectionForProvider(
    providerId: string,
    organization?: string,
  ): boolean {
    return this.ctx.storage.sql
      .exec<OAuthConnectionRow>(
        'SELECT * FROM oauth_connections WHERE provider = ?',
        providerId,
      )
      .toArray()
      .map(toOAuthConnection)
      .some((connection) =>
        connectionMatchesOrganization(connection, organization),
      )
  }

  getOAuthProvider(
    organization: string,
    providerId: string,
  ): OAuthProviderRecord | undefined {
    const rows = this.ctx.storage.sql
      .exec<OAuthProviderRow>(
        `SELECT * FROM oauth_providers
         WHERE organization = ? AND provider_id = ? LIMIT 1`,
        organization,
        providerId,
      )
      .toArray()
    return rows[0] ? toOAuthProvider(rows[0]) : undefined
  }

  listOAuthProviders(filter: OAuthProviderFilter): OAuthProviderRecord[] {
    const search = filter.search?.trim().toLowerCase()
    const providers = this.ctx.storage.sql
      .exec<OAuthProviderRow>(
        `SELECT * FROM oauth_providers
         WHERE organization = ? ORDER BY provider_id`,
        filter.organization,
      )
      .toArray()
      .map(toOAuthProvider)
      .filter(
        (provider) =>
          !search ||
          provider.providerId.toLowerCase().includes(search) ||
          provider.label?.toLowerCase().includes(search) ||
          provider.templateId.toLowerCase().includes(search),
      )
    return filter.limit ? providers.slice(0, filter.limit) : providers
  }

  putOAuthProvider(input: NewOAuthProviderRecord): OAuthProviderRecord {
    const now = Date.now()
    const existing = this.getOAuthProvider(input.organization, input.providerId)
    const id = existing?.id ?? crypto.randomUUID()
    this.ctx.storage.sql.exec(
      `INSERT INTO oauth_providers (
        id, organization, provider_id, template_id, label, credential_mode,
        client_id, client_secret_path, configuration, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(organization, provider_id) DO UPDATE SET
        template_id = excluded.template_id,
        label = excluded.label,
        credential_mode = excluded.credential_mode,
        client_id = excluded.client_id,
        client_secret_path = excluded.client_secret_path,
        configuration = excluded.configuration,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at`,
      id,
      input.organization,
      input.providerId,
      input.templateId,
      input.label,
      input.credentialMode,
      input.clientId,
      input.clientSecretPath,
      JSON.stringify(input.configuration),
      input.enabled ? 1 : 0,
      existing?.createdAt.getTime() ?? now,
      now,
    )
    const stored = this.getOAuthProvider(input.organization, input.providerId)
    if (!stored) throw new Error('Stored OAuth provider could not be read.')
    return stored
  }

  updateOAuthProvider(
    id: string,
    update: OAuthProviderUpdate,
  ): OAuthProviderRecord | undefined {
    const existingRow = this.ctx.storage.sql
      .exec<OAuthProviderRow>(
        'SELECT * FROM oauth_providers WHERE id = ? LIMIT 1',
        id,
      )
      .toArray()[0]
    if (!existingRow) return undefined
    const provider = { ...toOAuthProvider(existingRow), ...update }
    const rows = this.ctx.storage.sql
      .exec<OAuthProviderRow>(
        `UPDATE oauth_providers SET
          template_id = ?, label = ?, credential_mode = ?, client_id = ?,
          client_secret_path = ?, configuration = ?, enabled = ?, updated_at = ?
         WHERE id = ? RETURNING *`,
        provider.templateId,
        provider.label,
        provider.credentialMode,
        provider.clientId,
        provider.clientSecretPath,
        JSON.stringify(provider.configuration),
        provider.enabled ? 1 : 0,
        Date.now(),
        id,
      )
      .toArray()
    return rows[0] ? toOAuthProvider(rows[0]) : undefined
  }

  deleteOAuthProviderIfUnused(
    id: string,
    providerId: string,
    organization?: string,
  ): 'deleted' | 'not_found' | 'in_use' {
    return this.ctx.storage.transactionSync(() => {
      const existing = this.ctx.storage.sql
        .exec<{ id: string }>(
          'SELECT id FROM oauth_providers WHERE id = ? LIMIT 1',
          id,
        )
        .toArray()[0]
      if (!existing) return 'not_found'
      if (this.hasOAuthConnectionForProvider(providerId, organization)) {
        return 'in_use'
      }
      this.ctx.storage.sql.exec('DELETE FROM oauth_providers WHERE id = ?', id)
      return 'deleted'
    })
  }

  putVaultSecret(input: NewVaultSecret): VaultSecret {
    const now = Date.now()
    const existing = this.getVaultSecret(input.organization, input.path)
    const id = existing?.id ?? crypto.randomUUID()
    this.ctx.storage.sql.exec(
      `INSERT INTO vault_secrets (
        id, organization, path, value, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(organization, path) DO UPDATE SET
        value = excluded.value, updated_at = excluded.updated_at`,
      id,
      input.organization,
      input.path,
      input.value,
      existing?.createdAt.getTime() ?? now,
      now,
    )
    const stored = this.getVaultSecret(input.organization, input.path)
    if (!stored) throw new Error('Stored vault secret could not be read.')
    return stored
  }

  getVaultSecret(organization: string, path: string): VaultSecret | undefined {
    const rows = this.ctx.storage.sql
      .exec<VaultSecretRow>(
        `SELECT * FROM vault_secrets
         WHERE organization = ? AND path = ? LIMIT 1`,
        organization,
        path,
      )
      .toArray()
    return rows[0] ? toVaultSecret(rows[0]) : undefined
  }

  listVaultSecrets(filter: VaultSecretFilter): VaultSecretMetadata[] {
    return this.ctx.storage.sql
      .exec<VaultSecretRow>(
        `SELECT * FROM vault_secrets
         WHERE organization = ? ORDER BY path`,
        filter.organization,
      )
      .toArray()
      .map(toVaultSecret)
      .filter(
        (secret) =>
          (!filter.prefix || pathMatchesScope(secret.path, filter.prefix)) &&
          (!filter.scopes ||
            filter.scopes.includes('**') ||
            filter.scopes.some((scope) =>
              pathMatchesScope(secret.path, scope),
            )) &&
          (!filter.excludeInternalPrefix ||
            !secret.path.startsWith(filter.excludeInternalPrefix)),
      )
      .map(({ path, createdAt, updatedAt }) => ({
        path,
        createdAt,
        updatedAt,
      }))
  }

  deleteVaultSecret(organization: string, path: string): boolean {
    return (
      this.ctx.storage.sql.exec(
        'DELETE FROM vault_secrets WHERE organization = ? AND path = ?',
        organization,
        path,
      ).rowsWritten > 0
    )
  }

  getValidBrokerAccessToken(
    name: string,
    tokenIdHash: string,
    now: Date,
  ): BrokerAccessToken | undefined {
    const rows = this.ctx.storage.sql
      .exec<BrokerAccessTokenRow>(
        `SELECT * FROM broker_access_tokens
         WHERE name = ? AND token_id_hash = ? AND expires_at > ? LIMIT 1`,
        name,
        tokenIdHash,
        now.getTime(),
      )
      .toArray()
    return rows[0] ? toBrokerAccessToken(rows[0]) : undefined
  }

  purgeExpiredBrokerAccessTokens(before: Date): void {
    this.ctx.storage.sql.exec(
      'DELETE FROM broker_access_tokens WHERE expires_at <= ?',
      before.getTime(),
    )
  }

  createBrokerAccessToken(input: NewBrokerAccessToken): boolean {
    return (
      this.ctx.storage.sql.exec(
        `INSERT INTO broker_access_tokens (
          name, token_id_hash, scopes, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?) ON CONFLICT(name) DO NOTHING`,
        input.name,
        input.tokenIdHash,
        JSON.stringify(input.scopes),
        Date.now(),
        input.expiresAt.getTime(),
      ).rowsWritten > 0
    )
  }

  listBrokerAccessTokenNames(): string[] {
    return this.ctx.storage.sql
      .exec<{ name: string }>(
        'SELECT name FROM broker_access_tokens ORDER BY name',
      )
      .toArray()
      .map(({ name }) => name)
  }

  deleteBrokerAccessToken(name: string): boolean {
    return (
      this.ctx.storage.sql.exec(
        'DELETE FROM broker_access_tokens WHERE name = ?',
        name,
      ).rowsWritten > 0
    )
  }
}

export type DurableObjectDatabaseResolver<Bindings extends object> = (
  bindings: Bindings,
  context: DatabaseContext,
) => Database

/** Resolve a tenant-specific Durable Object stub from runtime bindings. */
export function durableObjects<Bindings extends object>(
  resolve: DurableObjectDatabaseResolver<Bindings>,
) {
  return defineDatabase<Bindings>((bindings, context = {}) =>
    resolve(bindings, context),
  )
}
