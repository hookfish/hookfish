import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import type { PgliteDatabase } from 'drizzle-orm/pglite'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

/**
 * OAuth provider dialect + credentials. Metadata is plain; client id/secret
 * are encrypted at rest with `OAUTH_ENCRYPTION_KEY` (same as connection tokens).
 */
export const oauthProviders = pgTable(
  'oauth_providers',
  {
    id: text('id').primaryKey(),
    label: text('label').notNull(),
    authorizeUrl: text('authorize_url').notNull(),
    tokenUrl: text('token_url').notNull(),
    defaultScopes: text('default_scopes').array().notNull().default([]),
    scopeSeparator: text('scope_separator').notNull().default(' '),
    tokenRequestFormat: text('token_request_format').notNull().default('form'),
    clientAuth: text('client_auth').notNull().default('body'),
    usePkce: boolean('use_pkce').notNull().default(false),
    supportsRefresh: boolean('supports_refresh').notNull().default(true),
    authorizeParams: jsonb('authorize_params')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    /** Top-level token-response field used as external_account_id. */
    accountIdField: text('account_id_field'),
    /** Top-level token-response field used as external_account_label. */
    accountLabelField: text('account_label_field'),
    clientIdEncrypted: text('client_id_encrypted'),
    clientSecretEncrypted: text('client_secret_encrypted'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('oauth_providers_enabled_idx').on(table.enabled)],
)

/**
 * One row per connection. A connection_id is a single provider link -- multiple
 * accounts on the same provider are multiple connection ids. Tokens are stored
 * encrypted at rest -- see `oauth/crypto.ts`. The plaintext never touches the
 * database.
 */
export const oauthConnections = pgTable(
  'oauth_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    connectionId: text('connection_id').notNull(),
    provider: text('provider').notNull(),

    accessToken: text('access_token_encrypted').notNull(),
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
    uniqueIndex('oauth_connections_connection_id_idx').on(table.connectionId),
    index('oauth_connections_provider_idx').on(table.provider),
  ],
)

/**
 * Short-lived CSRF/PKCE state for an in-flight authorization. Rows are
 * single-use: the callback deletes the row as it consumes it.
 */
export const oauthStates = pgTable(
  'oauth_states',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id').notNull(),
    provider: text('provider').notNull(),
    codeVerifier: text('code_verifier'),
    redirectUri: text('redirect_uri').notNull(),
    /** Where to send the browser once the callback finishes. */
    returnTo: text('return_to'),
    scopes: text('scopes').array().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('oauth_states_expires_idx').on(table.expiresAt)],
)

export type OAuthProvider = typeof oauthProviders.$inferSelect
export type OAuthConnection = typeof oauthConnections.$inferSelect
export type OAuthState = typeof oauthStates.$inferSelect

type Schema = {
  oauthProviders: typeof oauthProviders
  oauthConnections: typeof oauthConnections
  oauthStates: typeof oauthStates
}

/**
 * The broker only ever uses the subset of Drizzle that both drivers implement,
 * so route code is written once and runs on PGlite (local) or postgres.js
 * (stock Node / Workers + Hyperdrive or DATABASE_URL).
 */
export type Database = PostgresJsDatabase<Schema> | PgliteDatabase<Schema>
