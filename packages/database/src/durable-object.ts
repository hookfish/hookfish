import { DurableObject } from 'cloudflare:workers'
import {
  type BrokerAccessToken,
  type Connection,
  type ConnectionFilter,
  type ConnectionSummary,
  type ConnectionUpdate,
  type Database,
  defineDatabase,
  type NewBrokerAccessToken,
  type NewConnection,
  type NewOAuthState,
  type NewVaultSecret,
  type OAuthState,
  type OAuthStateUpdate,
  type VaultSecret,
  type VaultSecretFilter,
  type VaultSecretMetadata,
} from '@hookfish/api/database'

type OAuthStateRow = {
  id: string
  namespace: string
  provider_id: string
  code_verifier: string | null
  redirect_uri: string
  return_to: string | null
  scopes: string
  issuer: string | null
  status: string
  error_status: number | null
  error_code: string | null
  error_message: string | null
  completed_at: number | null
  created_at: number
  expires_at: number
}

type ConnectionRow = {
  id: string
  namespace: string
  provider_id: string
  configuration: string
  oauth_issuer: string | null
  oauth_client_id: string | null
  oauth_client_secret: string | null
  secret: string | null
  refresh_token: string | null
  token_type: string
  requested_scopes: string
  scopes: string
  expires_at: number | null
  metadata: string
  external_account_id: string | null
  external_account_label: string | null
  created_at: number
  updated_at: number
}

type VaultSecretRow = {
  id: string
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
    namespace: row.namespace,
    providerId: row.provider_id,
    codeVerifier: row.code_verifier,
    redirectUri: row.redirect_uri,
    returnTo: row.return_to,
    scopes: decodeStringArray(row.scopes),
    issuer: row.issuer,
    status: row.status,
    errorStatus: row.error_status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    completedAt: row.completed_at === null ? null : new Date(row.completed_at),
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
  }
}

function toConnection(row: ConnectionRow): Connection {
  return {
    id: row.id,
    namespace: row.namespace,
    providerId: row.provider_id,
    configuration: decodeObject(row.configuration),
    oauthIssuer: row.oauth_issuer,
    oauthClientId: row.oauth_client_id,
    oauthClientSecret: row.oauth_client_secret,
    secret: row.secret,
    refreshToken: row.refresh_token,
    tokenType: row.token_type,
    requestedScopes: decodeStringArray(row.requested_scopes),
    scopes: decodeStringArray(row.scopes),
    expiresAt: row.expires_at === null ? null : new Date(row.expires_at),
    metadata: decodeObject(row.metadata),
    externalAccountId: row.external_account_id,
    externalAccountLabel: row.external_account_label,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

function toVaultSecret(row: VaultSecretRow): VaultSecret {
  return {
    id: row.id,
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

function pathMatchesScope(path: string, scope: string): boolean {
  if (scope === '**') return true
  const isNamespace = scope.endsWith('/**')
  const root = isNamespace ? scope.slice(0, -3) : scope
  return path === root || (isNamespace && path.startsWith(`${root}/`))
}

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
    if (current >= 3) return

    this.ctx.storage.transactionSync(() => {
      if (current < 2) {
        this.ctx.storage.sql.exec(`
          DROP TABLE IF EXISTS oauth_states;
          DROP TABLE IF EXISTS oauth_connections;
          DROP TABLE IF EXISTS oauth_providers;
          DROP TABLE IF EXISTS connections;

          CREATE TABLE connections (
            id TEXT PRIMARY KEY,
            organization TEXT NOT NULL,
            namespace TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            configuration TEXT NOT NULL,
            oauth_issuer TEXT,
            oauth_client_id TEXT,
            oauth_client_secret TEXT,
            secret TEXT,
            refresh_token TEXT,
            token_type TEXT NOT NULL,
            requested_scopes TEXT NOT NULL,
            scopes TEXT NOT NULL,
            expires_at INTEGER,
            metadata TEXT NOT NULL,
            external_account_id TEXT,
            external_account_label TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(organization, namespace, provider_id)
          );
          CREATE INDEX connections_organization_idx ON connections(organization);
          CREATE INDEX connections_provider_idx ON connections(provider_id);

          CREATE TABLE oauth_states (
            id TEXT PRIMARY KEY,
            organization TEXT NOT NULL,
            namespace TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            code_verifier TEXT,
            redirect_uri TEXT NOT NULL,
            return_to TEXT,
            scopes TEXT NOT NULL,
            issuer TEXT,
            status TEXT NOT NULL,
            error_status INTEGER,
            error_code TEXT,
            error_message TEXT,
            completed_at INTEGER,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
          );
          CREATE INDEX oauth_states_expires_idx ON oauth_states(expires_at);

          CREATE TABLE IF NOT EXISTS broker_access_tokens (
            name TEXT PRIMARY KEY,
            token_id_hash TEXT NOT NULL UNIQUE,
            scopes TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS broker_access_tokens_expires_idx
            ON broker_access_tokens(expires_at);

          CREATE TABLE IF NOT EXISTS vault_secrets (
            id TEXT PRIMARY KEY,
            organization TEXT NOT NULL,
            path TEXT NOT NULL,
            value TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(organization, path)
          );
          CREATE INDEX IF NOT EXISTS vault_secrets_organization_idx
            ON vault_secrets(organization);
        `)
      }

      this.ctx.storage.sql.exec(`
          CREATE TABLE connections_v3 (
            id TEXT PRIMARY KEY,
            namespace TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            configuration TEXT NOT NULL,
            oauth_issuer TEXT,
            oauth_client_id TEXT,
            oauth_client_secret TEXT,
            secret TEXT,
            refresh_token TEXT,
            token_type TEXT NOT NULL,
            requested_scopes TEXT NOT NULL,
            scopes TEXT NOT NULL,
            expires_at INTEGER,
            metadata TEXT NOT NULL,
            external_account_id TEXT,
            external_account_label TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(namespace, provider_id)
          );
          INSERT INTO connections_v3
          SELECT id,
            CASE
              WHEN organization = '' THEN namespace
              WHEN namespace = '' THEN 'organizations/' || organization
              ELSE 'organizations/' || organization || '/' || namespace
            END,
            provider_id, configuration, oauth_issuer, oauth_client_id,
            oauth_client_secret, secret, refresh_token, token_type,
            requested_scopes, scopes, expires_at, metadata,
            external_account_id, external_account_label, created_at, updated_at
          FROM connections;
          DROP TABLE connections;
          ALTER TABLE connections_v3 RENAME TO connections;

          CREATE TABLE oauth_states_v3 (
            id TEXT PRIMARY KEY,
            namespace TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            code_verifier TEXT,
            redirect_uri TEXT NOT NULL,
            return_to TEXT,
            scopes TEXT NOT NULL,
            issuer TEXT,
            status TEXT NOT NULL,
            error_status INTEGER,
            error_code TEXT,
            error_message TEXT,
            completed_at INTEGER,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
          );
          INSERT INTO oauth_states_v3
          SELECT id,
            CASE
              WHEN organization = '' THEN namespace
              WHEN namespace = '' THEN 'organizations/' || organization
              ELSE 'organizations/' || organization || '/' || namespace
            END,
            provider_id, code_verifier, redirect_uri, return_to, scopes, issuer,
            status, error_status, error_code, error_message, completed_at,
            created_at, expires_at
          FROM oauth_states;
          DROP TABLE oauth_states;
          ALTER TABLE oauth_states_v3 RENAME TO oauth_states;

          CREATE TABLE vault_secrets_v3 (
            id TEXT PRIMARY KEY,
            path TEXT NOT NULL UNIQUE,
            value TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          );
          INSERT INTO vault_secrets_v3
          SELECT id,
            CASE
              WHEN organization = '' THEN path
              ELSE 'organizations/' || path
            END,
            value, created_at, updated_at
          FROM vault_secrets;
          DROP TABLE vault_secrets;
          ALTER TABLE vault_secrets_v3 RENAME TO vault_secrets;

        `)

      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS connections (
          id TEXT PRIMARY KEY,
          namespace TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          configuration TEXT NOT NULL,
          oauth_issuer TEXT,
          oauth_client_id TEXT,
          oauth_client_secret TEXT,
          secret TEXT,
          refresh_token TEXT,
          token_type TEXT NOT NULL,
          requested_scopes TEXT NOT NULL,
          scopes TEXT NOT NULL,
          expires_at INTEGER,
          metadata TEXT NOT NULL,
          external_account_id TEXT,
          external_account_label TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          UNIQUE(namespace, provider_id)
        );
        CREATE INDEX IF NOT EXISTS connections_provider_idx ON connections(provider_id);

        CREATE TABLE IF NOT EXISTS oauth_states (
          id TEXT PRIMARY KEY,
          namespace TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          code_verifier TEXT,
          redirect_uri TEXT NOT NULL,
          return_to TEXT,
          scopes TEXT NOT NULL,
          issuer TEXT,
          status TEXT NOT NULL,
          error_status INTEGER,
          error_code TEXT,
          error_message TEXT,
          completed_at INTEGER,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS oauth_states_expires_idx ON oauth_states(expires_at);

        CREATE TABLE IF NOT EXISTS broker_access_tokens (
          name TEXT PRIMARY KEY,
          token_id_hash TEXT NOT NULL UNIQUE,
          scopes TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS broker_access_tokens_expires_idx
          ON broker_access_tokens(expires_at);

        CREATE TABLE IF NOT EXISTS vault_secrets (
          id TEXT PRIMARY KEY,
          path TEXT NOT NULL UNIQUE,
          value TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `)
      this.ctx.storage.sql.exec(
        `INSERT INTO _hookfish_schema_migrations(version, applied_at)
         VALUES (3, ?)`,
        Date.now(),
      )
    })
  }

  createOAuthState(input: NewOAuthState): void {
    const now = Date.now()
    this.ctx.storage.sql.exec(
      `INSERT INTO oauth_states (
        id, namespace, provider_id, code_verifier, redirect_uri,
        return_to, scopes, issuer, status, error_status, error_code,
        error_message, completed_at, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`,
      input.id,
      input.namespace,
      input.providerId,
      input.codeVerifier ?? null,
      input.redirectUri,
      input.returnTo ?? null,
      JSON.stringify(input.scopes),
      input.issuer ?? null,
      input.status ?? 'pending',
      now,
      input.expiresAt.getTime(),
    )
  }

  supersedeOAuthStates(namespace: string, providerId: string): void {
    this.ctx.storage.sql.exec(
      `UPDATE oauth_states SET status = 'failed', error_status = 409,
        error_code = 'authorization_superseded',
        error_message = 'A newer authorization flow was started.',
        completed_at = ?
       WHERE namespace = ? AND provider_id = ?
         AND status = 'pending'`,
      Date.now(),
      namespace,
      providerId,
    )
  }

  claimOAuthState(
    ids: readonly string[],
    providerId: string,
  ): OAuthState | undefined {
    if (ids.length === 0) return undefined
    const placeholders = ids.map(() => '?').join(', ')
    const rows = this.ctx.storage.sql
      .exec<OAuthStateRow>(
        `UPDATE oauth_states SET status = 'processing'
         WHERE id IN (${placeholders}) AND provider_id = ? AND status = 'pending'
         RETURNING *`,
        ...ids,
        providerId,
      )
      .toArray()
    return rows[0] ? toOAuthState(rows[0]) : undefined
  }

  getOAuthState(
    ids: readonly string[],
    providerId: string,
  ): OAuthState | undefined {
    if (ids.length === 0) return undefined
    const placeholders = ids.map(() => '?').join(', ')
    const rows = this.ctx.storage.sql
      .exec<OAuthStateRow>(
        `SELECT * FROM oauth_states
         WHERE id IN (${placeholders}) AND provider_id = ? LIMIT 1`,
        ...ids,
        providerId,
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
        `UPDATE oauth_states SET status = ?, error_status = ?, error_code = ?,
          error_message = ?, completed_at = ? WHERE id = ? RETURNING *`,
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

  getConnection(namespace: string, providerId: string): Connection | undefined {
    const row = this.ctx.storage.sql
      .exec<ConnectionRow>(
        `SELECT * FROM connections WHERE namespace = ?
         AND provider_id = ? LIMIT 1`,
        namespace,
        providerId,
      )
      .toArray()[0]
    return row ? toConnection(row) : undefined
  }

  putConnection(input: NewConnection): Connection {
    const existing = this.getConnection(input.namespace, input.providerId)
    if (existing) return existing
    const now = Date.now()
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO connections (
        id, namespace, provider_id, configuration, oauth_issuer,
        oauth_client_id, oauth_client_secret, secret, refresh_token, token_type,
        requested_scopes, scopes, expires_at, metadata, external_account_id,
        external_account_label, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      input.namespace,
      input.providerId,
      JSON.stringify(input.configuration),
      input.oauthIssuer ?? null,
      input.oauthClientId ?? null,
      input.oauthClientSecret ?? null,
      input.secret ?? null,
      input.refreshToken ?? null,
      input.tokenType ?? 'Bearer',
      JSON.stringify(input.requestedScopes ?? []),
      JSON.stringify(input.scopes ?? []),
      input.expiresAt?.getTime() ?? null,
      JSON.stringify(input.metadata ?? {}),
      input.externalAccountId ?? null,
      input.externalAccountLabel ?? null,
      now,
      now,
    )
    const stored = this.getConnection(input.namespace, input.providerId)
    if (!stored) throw new Error('Connection could not be stored.')
    return stored
  }

  updateConnection(
    id: string,
    update: ConnectionUpdate,
  ): Connection | undefined {
    const row = this.ctx.storage.sql
      .exec<ConnectionRow>('SELECT * FROM connections WHERE id = ? LIMIT 1', id)
      .toArray()[0]
    if (!row) return undefined
    const value = { ...toConnection(row), ...update }
    const updated = this.ctx.storage.sql
      .exec<ConnectionRow>(
        `UPDATE connections SET configuration = ?, oauth_issuer = ?,
          oauth_client_id = ?, oauth_client_secret = ?, secret = ?,
          refresh_token = ?, token_type = ?, requested_scopes = ?, scopes = ?,
          expires_at = ?, metadata = ?, external_account_id = ?, external_account_label = ?,
          updated_at = ? WHERE id = ? RETURNING *`,
        JSON.stringify(value.configuration),
        value.oauthIssuer,
        value.oauthClientId,
        value.oauthClientSecret,
        value.secret,
        value.refreshToken,
        value.tokenType,
        JSON.stringify(value.requestedScopes),
        JSON.stringify(value.scopes),
        value.expiresAt?.getTime() ?? null,
        JSON.stringify(value.metadata),
        value.externalAccountId,
        value.externalAccountLabel,
        Date.now(),
        id,
      )
      .toArray()[0]
    return updated ? toConnection(updated) : undefined
  }

  listConnections(filter: ConnectionFilter = {}): ConnectionSummary[] {
    return this.ctx.storage.sql
      .exec<ConnectionRow>(
        'SELECT * FROM connections ORDER BY namespace, provider_id',
      )
      .toArray()
      .map(toConnection)
      .filter((connection) => {
        const path = connection.namespace
          ? `${connection.namespace}/${connection.providerId}`
          : connection.providerId
        return (
          (!filter.providerId || connection.providerId === filter.providerId) &&
          (!filter.namespace ||
            connection.namespace === filter.namespace ||
            connection.namespace.startsWith(`${filter.namespace}/`)) &&
          (!filter.resourceScopes ||
            filter.resourceScopes.some((scope) =>
              pathMatchesScope(path, scope),
            ))
        )
      })
      .map(
        ({
          namespace,
          providerId,
          configuration,
          scopes,
          expiresAt,
          externalAccountId,
          externalAccountLabel,
          metadata,
          createdAt,
          updatedAt,
        }) => ({
          namespace,
          providerId,
          configuration,
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

  deleteConnection(id: string): boolean {
    return (
      this.ctx.storage.sql.exec('DELETE FROM connections WHERE id = ?', id)
        .rowsWritten > 0
    )
  }

  putVaultSecret(input: NewVaultSecret): VaultSecret {
    const now = Date.now()
    const existing = this.getVaultSecret(input.path)
    const id = existing?.id ?? crypto.randomUUID()
    this.ctx.storage.sql.exec(
      `INSERT INTO vault_secrets (
        id, path, value, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        value = excluded.value, updated_at = excluded.updated_at`,
      id,
      input.path,
      input.value,
      existing?.createdAt.getTime() ?? now,
      now,
    )
    const stored = this.getVaultSecret(input.path)
    if (!stored) throw new Error('Stored vault secret could not be read.')
    return stored
  }

  getVaultSecret(path: string): VaultSecret | undefined {
    const row = this.ctx.storage.sql
      .exec<VaultSecretRow>(
        `SELECT * FROM vault_secrets WHERE path = ? LIMIT 1`,
        path,
      )
      .toArray()[0]
    return row ? toVaultSecret(row) : undefined
  }

  listVaultSecrets(filter: VaultSecretFilter): VaultSecretMetadata[] {
    return this.ctx.storage.sql
      .exec<VaultSecretRow>('SELECT * FROM vault_secrets ORDER BY path')
      .toArray()
      .map(toVaultSecret)
      .filter(
        (secret) =>
          (!filter.prefix ||
            secret.path === filter.prefix ||
            secret.path.startsWith(`${filter.prefix}/`)) &&
          (!filter.scopes ||
            filter.scopes.some((scope) =>
              pathMatchesScope(secret.path, scope),
            )) &&
          (!filter.excludeInternalPrefix ||
            !secret.path.startsWith(filter.excludeInternalPrefix)),
      )
      .map(({ path, createdAt, updatedAt }) => ({ path, createdAt, updatedAt }))
  }

  deleteVaultSecret(path: string): boolean {
    return (
      this.ctx.storage.sql.exec(
        'DELETE FROM vault_secrets WHERE path = ?',
        path,
      ).rowsWritten > 0
    )
  }

  getValidBrokerAccessToken(
    name: string,
    tokenIdHash: string,
    now: Date,
  ): BrokerAccessToken | undefined {
    const row = this.ctx.storage.sql
      .exec<BrokerAccessTokenRow>(
        `SELECT * FROM broker_access_tokens
         WHERE name = ? AND token_id_hash = ? AND expires_at > ? LIMIT 1`,
        name,
        tokenIdHash,
        now.getTime(),
      )
      .toArray()[0]
    return row ? toBrokerAccessToken(row) : undefined
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
) => Database

export function durableObjects<Bindings extends object>(
  resolve: DurableObjectDatabaseResolver<Bindings>,
) {
  return defineDatabase<Bindings>((bindings) => resolve(bindings))
}
