import {
  and,
  asc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  notExists,
  or,
  sql,
} from 'drizzle-orm'
import {
  brokerAccessTokens,
  type DrizzleDatabase,
  oauthConnections,
  oauthProviders,
  oauthStates,
  vaultSecrets,
} from './schema'
import type { Database } from './types'

function connectionOrganizationFilter(organization: string | undefined) {
  if (!organization) return isNull(oauthConnections.organization)

  return or(
    eq(oauthConnections.organization, organization),
    and(
      isNull(oauthConnections.organization),
      or(
        eq(oauthConnections.connectionId, organization),
        sql<boolean>`starts_with(${oauthConnections.connectionId}, ${`${organization}/`})`,
      ),
    ),
  )
}

function pathScopeFilter(column: typeof vaultSecrets.path, scopes?: string[]) {
  if (scopes?.includes('**')) return undefined
  if (!scopes) return undefined
  if (scopes.length === 0) return sql<boolean>`false`

  return or(
    ...scopes.map((scope) => {
      const root = scope.endsWith('/**') ? scope.slice(0, -3) : scope
      return or(
        eq(column, root),
        sql<boolean>`starts_with(${column}, ${`${root}/`})`,
      )
    }),
  )
}

/** Wrap a supported Drizzle client in Hookfish's database-agnostic contract. */
export function drizzleDatabase(db: DrizzleDatabase): Database {
  return {
    async createOAuthState(input) {
      await db.insert(oauthStates).values(input)
    },

    async claimOAuthState(ids, provider) {
      const [state] = await db
        .update(oauthStates)
        .set({ status: 'processing' })
        .where(
          and(
            inArray(oauthStates.id, [...ids]),
            eq(oauthStates.provider, provider),
            eq(oauthStates.status, 'pending'),
          ),
        )
        .returning()
      return state
    },

    async getOAuthState(ids, provider) {
      const [state] = await db
        .select()
        .from(oauthStates)
        .where(
          and(
            inArray(oauthStates.id, [...ids]),
            eq(oauthStates.provider, provider),
          ),
        )
        .limit(1)
      return state
    },

    async updateOAuthState(id, update) {
      const [state] = await db
        .update(oauthStates)
        .set(update)
        .where(eq(oauthStates.id, id))
        .returning()
      return state
    },

    async purgeExpiredOAuthStates(before) {
      const deleted = await db
        .delete(oauthStates)
        .where(lt(oauthStates.expiresAt, before))
        .returning()
      return deleted.length
    },

    async getOAuthConnection(connectionId, organization) {
      const [connection] = await db
        .select()
        .from(oauthConnections)
        .where(
          and(
            eq(oauthConnections.connectionId, connectionId),
            connectionOrganizationFilter(organization),
          ),
        )
        .limit(1)
      return connection
    },

    async upsertOAuthConnection(input) {
      const [connection] = await db
        .insert(oauthConnections)
        .values(input)
        .onConflictDoUpdate({
          target: oauthConnections.connectionId,
          set: {
            accessToken: input.accessToken,
            refreshToken: input.refreshToken,
            tokenType: input.tokenType,
            scopes: input.scopes,
            expiresAt: input.expiresAt,
            metadata: input.metadata,
            externalAccountId: input.externalAccountId,
            externalAccountLabel: input.externalAccountLabel,
            organization: input.organization,
            updatedAt: new Date(),
          },
          setWhere: and(
            eq(oauthConnections.provider, input.provider),
            connectionOrganizationFilter(input.organization ?? undefined),
          ),
        })
        .returning()
      return connection
    },

    async updateOAuthConnectionTokens(id, update) {
      const [connection] = await db
        .update(oauthConnections)
        .set({ ...update, updatedAt: new Date() })
        .where(eq(oauthConnections.id, id))
        .returning()
      return connection
    },

    async listOAuthConnections(filter = {}) {
      const prefixFilter = filter.connectionIdPrefix
        ? filter.connectionIdPrefix.endsWith('/')
          ? sql<boolean>`starts_with(${oauthConnections.connectionId}, ${filter.connectionIdPrefix})`
          : or(
              eq(oauthConnections.connectionId, filter.connectionIdPrefix),
              sql<boolean>`starts_with(${oauthConnections.connectionId}, ${`${filter.connectionIdPrefix}/`})`,
            )
        : undefined
      const scopeFilter = filter.connectionScopes?.includes('**')
        ? undefined
        : filter.connectionScopes?.length
          ? or(
              ...filter.connectionScopes.map((scope) => {
                const root = scope.endsWith('/**') ? scope.slice(0, -3) : scope
                return or(
                  eq(oauthConnections.connectionId, root),
                  sql<boolean>`starts_with(${oauthConnections.connectionId}, ${`${root}/`})`,
                )
              }),
            )
          : filter.connectionScopes
            ? sql<boolean>`false`
            : undefined

      return db
        .select({
          connectionId: oauthConnections.connectionId,
          provider: oauthConnections.provider,
          scopes: oauthConnections.scopes,
          expiresAt: oauthConnections.expiresAt,
          externalAccountId: oauthConnections.externalAccountId,
          externalAccountLabel: oauthConnections.externalAccountLabel,
          metadata: oauthConnections.metadata,
          createdAt: oauthConnections.createdAt,
          updatedAt: oauthConnections.updatedAt,
        })
        .from(oauthConnections)
        .where(
          and(
            connectionOrganizationFilter(filter.organization),
            filter.provider
              ? eq(oauthConnections.provider, filter.provider)
              : undefined,
            prefixFilter,
            scopeFilter,
          ),
        )
    },

    async deleteOAuthConnection(id) {
      const deleted = await db
        .delete(oauthConnections)
        .where(eq(oauthConnections.id, id))
        .returning()
      return deleted.length > 0
    },

    async hasOAuthConnectionForProvider(providerId, organization) {
      const connection = await db
        .select({ id: oauthConnections.id })
        .from(oauthConnections)
        .where(
          and(
            eq(oauthConnections.provider, providerId),
            connectionOrganizationFilter(organization),
          ),
        )
        .limit(1)
      return connection.length > 0
    },

    async getOAuthProvider(organization, providerId) {
      const [provider] = await db
        .select()
        .from(oauthProviders)
        .where(
          and(
            eq(oauthProviders.organization, organization),
            eq(oauthProviders.providerId, providerId),
          ),
        )
        .limit(1)
      return provider
    },

    async listOAuthProviders(filter) {
      const search = filter.search?.trim()
      const condition = search
        ? and(
            eq(oauthProviders.organization, filter.organization),
            or(
              ilike(oauthProviders.providerId, `%${search}%`),
              ilike(oauthProviders.label, `%${search}%`),
              ilike(oauthProviders.templateId, `%${search}%`),
            ),
          )
        : eq(oauthProviders.organization, filter.organization)
      const query = db
        .select()
        .from(oauthProviders)
        .where(condition)
        .orderBy(asc(oauthProviders.providerId))
      return filter.limit ? query.limit(filter.limit) : query
    },

    async putOAuthProvider(input) {
      const [provider] = await db
        .insert(oauthProviders)
        .values(input)
        .onConflictDoUpdate({
          target: [oauthProviders.organization, oauthProviders.providerId],
          set: {
            templateId: input.templateId,
            label: input.label,
            credentialMode: input.credentialMode,
            clientId: input.clientId,
            clientSecretPath: input.clientSecretPath,
            configuration: input.configuration,
            enabled: input.enabled,
            updatedAt: new Date(),
          },
        })
        .returning()
      return provider
    },

    async updateOAuthProvider(id, update) {
      const [provider] = await db
        .update(oauthProviders)
        .set({ ...update, updatedAt: new Date() })
        .where(eq(oauthProviders.id, id))
        .returning()
      return provider
    },

    async deleteOAuthProviderIfUnused(id, providerId, organization) {
      const inUse = db
        .select({ id: oauthConnections.id })
        .from(oauthConnections)
        .where(
          and(
            eq(oauthConnections.provider, providerId),
            connectionOrganizationFilter(organization),
          ),
        )
      const deleted = await db
        .delete(oauthProviders)
        .where(and(eq(oauthProviders.id, id), notExists(inUse)))
        .returning()
      if (deleted.length > 0) return 'deleted'

      const existing = await db
        .select({ id: oauthProviders.id })
        .from(oauthProviders)
        .where(eq(oauthProviders.id, id))
        .limit(1)
      return existing.length > 0 ? 'in_use' : 'not_found'
    },

    async putVaultSecret(input) {
      const [secret] = await db
        .insert(vaultSecrets)
        .values(input)
        .onConflictDoUpdate({
          target: [vaultSecrets.organization, vaultSecrets.path],
          set: { value: input.value, updatedAt: new Date() },
        })
        .returning()
      return secret
    },

    async getVaultSecret(organization, path) {
      const [secret] = await db
        .select()
        .from(vaultSecrets)
        .where(
          and(
            eq(vaultSecrets.organization, organization),
            eq(vaultSecrets.path, path),
          ),
        )
        .limit(1)
      return secret
    },

    async listVaultSecrets(filter) {
      const prefixFilter = filter.prefix
        ? or(
            eq(vaultSecrets.path, filter.prefix),
            sql<boolean>`starts_with(${vaultSecrets.path}, ${`${filter.prefix}/`})`,
          )
        : undefined
      return db
        .select({
          path: vaultSecrets.path,
          createdAt: vaultSecrets.createdAt,
          updatedAt: vaultSecrets.updatedAt,
        })
        .from(vaultSecrets)
        .where(
          and(
            eq(vaultSecrets.organization, filter.organization),
            prefixFilter,
            pathScopeFilter(vaultSecrets.path, filter.scopes),
            filter.excludeInternalPrefix
              ? sql<boolean>`not starts_with(${vaultSecrets.path}, ${filter.excludeInternalPrefix})`
              : undefined,
          ),
        )
        .orderBy(asc(vaultSecrets.path))
    },

    async deleteVaultSecret(organization, path) {
      const deleted = await db
        .delete(vaultSecrets)
        .where(
          and(
            eq(vaultSecrets.organization, organization),
            eq(vaultSecrets.path, path),
          ),
        )
        .returning()
      return deleted.length > 0
    },

    async getValidBrokerAccessToken(name, tokenIdHash, now) {
      const [token] = await db
        .select()
        .from(brokerAccessTokens)
        .where(
          and(
            eq(brokerAccessTokens.name, name),
            eq(brokerAccessTokens.tokenIdHash, tokenIdHash),
            gt(brokerAccessTokens.expiresAt, now),
          ),
        )
        .limit(1)
      return token
    },

    async purgeExpiredBrokerAccessTokens(before) {
      await db
        .delete(brokerAccessTokens)
        .where(lte(brokerAccessTokens.expiresAt, before))
    },

    async createBrokerAccessToken(input) {
      const inserted = await db
        .insert(brokerAccessTokens)
        .values(input)
        .onConflictDoNothing({ target: brokerAccessTokens.name })
        .returning()
      return inserted.length > 0
    },

    async listBrokerAccessTokenNames() {
      const tokens = await db
        .select({ name: brokerAccessTokens.name })
        .from(brokerAccessTokens)
        .orderBy(asc(brokerAccessTokens.name))
      return tokens.map(({ name }) => name)
    },

    async deleteBrokerAccessToken(name) {
      const deleted = await db
        .delete(brokerAccessTokens)
        .where(eq(brokerAccessTokens.name, name))
        .returning()
      return deleted.length > 0
    },
  }
}
