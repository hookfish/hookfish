import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import type { PgliteDatabase } from 'drizzle-orm/pglite'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

export type {
  BrokerAccessToken,
  Connection,
  OAuthState,
  VaultSecret,
} from './types'

/**
 * One row per structured connection identity. Credentials are encrypted at
 * rest; plaintext never touches the database.
 */
export const connections = pgTable(
  'connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organization: text('organization').notNull().default(''),
    namespace: text('namespace').notNull(),
    providerId: text('provider_id').notNull(),
    configuration: jsonb('configuration')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),

    oauthIssuer: text('oauth_issuer'),
    oauthClientId: text('oauth_client_id'),
    oauthClientSecret: text('oauth_client_secret_encrypted'),

    secret: text('secret_encrypted'),
    refreshToken: text('refresh_token_encrypted'),
    tokenType: text('token_type').notNull().default('Bearer'),
    scopes: text('scopes').array().notNull().default([]),
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    /**
     * Provider-specific extras returned by the token endpoint that are useful
     * to keep around: Notion's `workspace_id` / `bot_id`, Linear's actor, the
     * Google `id_token` claims, etc.
     */
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),

    /** Stable identifier for the remote account, when the provider gives one. */
    externalAccountId: text('external_account_id'),
    externalAccountLabel: text('external_account_label'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('connections_identity_idx').on(
      table.organization,
      table.namespace,
      table.providerId,
    ),
    index('connections_organization_idx').on(table.organization),
    index('connections_provider_idx').on(table.providerId),
  ],
)

/**
 * Short-lived CSRF/PKCE state for an authorization. The public state value is
 * hashed before storage; status transitions make callback completion
 * single-exchange and idempotent until the row expires.
 */
export const oauthStates = pgTable(
  'oauth_states',
  {
    id: text('id').primaryKey(),
    organization: text('organization').notNull().default(''),
    namespace: text('namespace').notNull(),
    providerId: text('provider_id').notNull(),
    codeVerifier: text('code_verifier'),
    redirectUri: text('redirect_uri').notNull(),
    returnTo: text('return_to'),
    scopes: text('scopes').array().notNull().default([]),
    issuer: text('issuer'),
    status: text('status').notNull().default('pending'),
    errorStatus: integer('error_status'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('oauth_states_expires_idx').on(table.expiresAt)],
)

/**
 * Administrative metadata for broker credentials. The signed credential itself is
 * never stored; this table exists so administrators can enumerate active
 * token names without exposing their scopes or bearer values.
 */
export const brokerAccessTokens = pgTable(
  'broker_access_tokens',
  {
    name: text('name').primaryKey(),
    tokenIdHash: text('token_id_hash').notNull(),
    scopes: text('scopes').array().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('broker_access_tokens_token_id_hash_idx').on(table.tokenIdHash),
    index('broker_access_tokens_expires_idx').on(table.expiresAt),
  ],
)

/** Encrypted arbitrary credentials. Plaintext values never touch the database. */
export const vaultSecrets = pgTable(
  'vault_secrets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organization: text('organization').notNull().default(''),
    path: text('path').notNull(),
    value: text('value_encrypted').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('vault_secrets_organization_path_idx').on(
      table.organization,
      table.path,
    ),
    index('vault_secrets_organization_idx').on(table.organization),
  ],
)

type Schema = {
  brokerAccessTokens: typeof brokerAccessTokens
  connections: typeof connections
  oauthStates: typeof oauthStates
  vaultSecrets: typeof vaultSecrets
}

/** Drizzle client type used internally by the Postgres and PGlite adapters. */
export type DrizzleDatabase =
  | PostgresJsDatabase<Schema>
  | PgliteDatabase<Schema>
