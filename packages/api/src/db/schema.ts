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

/**
 * OAuth IdP configuration. Anyone with the broker API key can register a
 * provider over the API -- no code or env changes required. Client credentials
 * are encrypted at rest with `OAUTH_ENCRYPTION_KEY` (same as connection tokens).
 */
export const oauthProviders = pgTable('oauth_providers', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  authorizeUrl: text('authorize_url').notNull(),
  tokenUrl: text('token_url').notNull(),
  defaultScopes: text('default_scopes').array().notNull().default([]),
  /** Google/GitHub use spaces; Linear uses commas. */
  scopeSeparator: text('scope_separator').notNull().default(' '),
  /** How the token endpoint wants the request encoded. */
  tokenRequestFormat: text('token_request_format').notNull().default('form'),
  /** Basic-auth header vs. client_id/client_secret in the body. */
  clientAuth: text('client_auth').notNull().default('body'),
  usePkce: boolean('use_pkce').notNull().default(false),
  supportsRefresh: boolean('supports_refresh').notNull().default(true),
  /** Static params appended to the authorize URL. */
  authorizeParams: jsonb('authorize_params')
    .$type<Record<string, string>>()
    .notNull()
    .default({}),
  /**
   * Dot-path into the token response for a stable account id / label
   * (e.g. Notion: `workspace_id` / `workspace_name`).
   */
  accountIdPath: text('account_id_path'),
  accountLabelPath: text('account_label_path'),
  clientIdEncrypted: text('client_id_encrypted').notNull(),
  clientSecretEncrypted: text('client_secret_encrypted').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

/**
 * One row per (connection group, provider) pair. A connection group is the
 * opaque bucket that owns connections (today: one per end-user of your app).
 * Tokens are stored encrypted at rest -- see `oauth/crypto.ts`.
 */
export const oauthConnections = pgTable(
  'oauth_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    connectionGroupId: text('connection_group_id').notNull(),
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
    uniqueIndex('oauth_connections_group_provider_idx').on(
      table.connectionGroupId,
      table.provider,
    ),
    index('oauth_connections_group_idx').on(table.connectionGroupId),
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
    connectionGroupId: text('connection_group_id').notNull(),
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
