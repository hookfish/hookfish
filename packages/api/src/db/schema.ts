import {
  type AnyPgColumn,
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
  AccessGrant,
  BrokerAccessToken,
  Connection,
  OAuthState,
} from './types.js'

/**
 * One row per structured connection identity. Credentials are encrypted at
 * rest; plaintext never touches the database.
 */
export const connections = pgTable(
  'connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
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
    requestedScopes: text('requested_scopes').array().notNull().default([]),
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
      table.namespace,
      table.providerId,
    ),
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

/** Persisted authorization that can be delegated and revoked as a tree. */
export const accessGrants = pgTable(
  'access_grants',
  {
    id: uuid('id').primaryKey(),
    parentGrantId: uuid('parent_grant_id').references(
      (): AnyPgColumn => accessGrants.id,
      { onDelete: 'cascade' },
    ),
    scopes: text('scopes').array().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('access_grants_parent_idx').on(table.parentGrantId),
    index('access_grants_expires_idx').on(table.expiresAt),
  ],
)

/**
 * Administrative metadata for broker credentials. Authorization lives on the
 * attached grant so deleting a grant revokes every token in its subtree.
 */
export const brokerAccessTokens = pgTable(
  'broker_access_tokens',
  {
    name: text('name').primaryKey(),
    tokenIdHash: text('token_id_hash').notNull(),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => accessGrants.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('broker_access_tokens_token_id_hash_idx').on(table.tokenIdHash),
    index('broker_access_tokens_grant_idx').on(table.grantId),
  ],
)

type Schema = {
  accessGrants: typeof accessGrants
  brokerAccessTokens: typeof brokerAccessTokens
  connections: typeof connections
  oauthStates: typeof oauthStates
}

/** Drizzle client type used internally by the Postgres and PGlite adapters. */
export type DrizzleDatabase =
  | PostgresJsDatabase<Schema>
  | PgliteDatabase<Schema>
