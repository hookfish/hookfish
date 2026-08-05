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
    organization: text('organization'),
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
    index('oauth_connections_organization_idx').on(table.organization),
    index('oauth_connections_provider_idx').on(table.provider),
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
    connectionId: text('connection_id').notNull(),
    organization: text('organization'),
    provider: text('provider').notNull(),
    codeVerifier: text('code_verifier'),
    redirectUri: text('redirect_uri').notNull(),
    returnTo: text('return_to'),
    scopes: text('scopes').array().notNull().default([]),
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

export type OAuthConnection = typeof oauthConnections.$inferSelect
export type OAuthState = typeof oauthStates.$inferSelect
export type BrokerAccessToken = typeof brokerAccessTokens.$inferSelect

type Schema = {
  brokerAccessTokens: typeof brokerAccessTokens
  oauthConnections: typeof oauthConnections
  oauthStates: typeof oauthStates
}

/**
 * The broker only uses the subset of Drizzle implemented by both supported
 * adapters, so route code is independent of how the database was constructed.
 */
export type Database = PostgresJsDatabase<Schema> | PgliteDatabase<Schema>
