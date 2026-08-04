import {
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
    scopes: text('scopes').array().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('oauth_states_expires_idx').on(table.expiresAt)],
)

/**
 * User-supplied credentials such as API keys and request headers. Secret
 * values are serialized and encrypted before this table is touched. The
 * owner id is deliberately present even while the default deployment uses a
 * single system owner, so adding user authentication does not require
 * redesigning the storage model.
 */
export const credentials = pgTable(
  'credentials',
  {
    id: uuid('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    encryptedPayload: text('encrypted_payload').notNull(),
    encryptionVersion: text('encryption_version').notNull().default('v1'),
    /** Non-secret field/header names, safe to show without decrypting. */
    fields: text('fields').array().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (table) => [
    index('credentials_owner_idx').on(table.ownerId),
    index('credentials_owner_kind_idx').on(table.ownerId, table.kind),
  ],
)

export type OAuthConnection = typeof oauthConnections.$inferSelect
export type OAuthState = typeof oauthStates.$inferSelect
export type Credential = typeof credentials.$inferSelect

type Schema = {
  credentials: typeof credentials
  oauthConnections: typeof oauthConnections
  oauthStates: typeof oauthStates
}

/**
 * The broker only uses the subset of Drizzle implemented by both supported
 * adapters, so route code is independent of how the database was constructed.
 */
export type Database = PostgresJsDatabase<Schema> | PgliteDatabase<Schema>
