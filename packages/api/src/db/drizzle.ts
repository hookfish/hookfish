import { and, asc, eq, gt, inArray, lt, lte, or, sql } from 'drizzle-orm'
import {
  brokerAccessTokens,
  connections,
  type DrizzleDatabase,
  oauthStates,
  vaultSecrets,
} from './schema'
import type { Database } from './types'

function pathScopeFilter(column: typeof vaultSecrets.path, scopes?: string[]) {
  if (scopes?.includes('**') || !scopes) return undefined
  if (scopes.length === 0) return sql<boolean>`false`

  return or(
    ...scopes.map((scope) => {
      const root = scope.endsWith('/**') ? scope.slice(0, -3) : scope
      return scope.endsWith('/**')
        ? or(
            eq(column, root),
            sql<boolean>`starts_with(${column}, ${`${root}/`})`,
          )
        : eq(column, root)
    }),
  )
}

function connectionScopeFilter(scopes?: string[]) {
  if (scopes?.includes('**') || !scopes) return undefined
  if (scopes.length === 0) return sql<boolean>`false`

  const path = sql<string>`CASE WHEN ${connections.namespace} = '' THEN ${connections.providerId} ELSE ${connections.namespace} || '/' || ${connections.providerId} END`
  return or(
    ...scopes.map((scope) => {
      const root = scope.endsWith('/**') ? scope.slice(0, -3) : scope
      return scope.endsWith('/**')
        ? or(eq(path, root), sql<boolean>`starts_with(${path}, ${`${root}/`})`)
        : eq(path, root)
    }),
  )
}

/** Wrap a supported Drizzle client in Hookfish's database-agnostic contract. */
export function drizzleDatabase(db: DrizzleDatabase): Database {
  return {
    async createOAuthState(input) {
      await db.insert(oauthStates).values(input)
    },

    async supersedeOAuthStates(organization, namespace, providerId) {
      await db
        .update(oauthStates)
        .set({
          status: 'failed',
          errorStatus: 409,
          errorCode: 'authorization_superseded',
          errorMessage: 'A newer authorization flow was started.',
          completedAt: new Date(),
        })
        .where(
          and(
            eq(oauthStates.organization, organization),
            eq(oauthStates.namespace, namespace),
            eq(oauthStates.providerId, providerId),
            eq(oauthStates.status, 'pending'),
          ),
        )
    },

    async claimOAuthState(ids, providerId) {
      const [state] = await db
        .update(oauthStates)
        .set({ status: 'processing' })
        .where(
          and(
            inArray(oauthStates.id, [...ids]),
            eq(oauthStates.providerId, providerId),
            eq(oauthStates.status, 'pending'),
          ),
        )
        .returning()
      return state
    },

    async getOAuthState(ids, providerId) {
      const [state] = await db
        .select()
        .from(oauthStates)
        .where(
          and(
            inArray(oauthStates.id, [...ids]),
            eq(oauthStates.providerId, providerId),
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

    async getConnection(organization, namespace, providerId) {
      const [connection] = await db
        .select()
        .from(connections)
        .where(
          and(
            eq(connections.organization, organization),
            eq(connections.namespace, namespace),
            eq(connections.providerId, providerId),
          ),
        )
        .limit(1)
      return connection
    },

    async putConnection(input) {
      const [inserted] = await db
        .insert(connections)
        .values(input)
        .onConflictDoNothing({
          target: [
            connections.organization,
            connections.namespace,
            connections.providerId,
          ],
        })
        .returning()
      if (inserted) return inserted

      const [existing] = await db
        .select()
        .from(connections)
        .where(
          and(
            eq(connections.organization, input.organization),
            eq(connections.namespace, input.namespace),
            eq(connections.providerId, input.providerId),
          ),
        )
        .limit(1)
      if (!existing) throw new Error('Connection could not be stored.')
      return existing
    },

    async updateConnection(id, update) {
      const [connection] = await db
        .update(connections)
        .set({ ...update, updatedAt: new Date() })
        .where(eq(connections.id, id))
        .returning()
      return connection
    },

    async listConnections(filter = {}) {
      const namespaceFilter = filter.namespace
        ? or(
            eq(connections.namespace, filter.namespace),
            sql<boolean>`starts_with(${connections.namespace}, ${`${filter.namespace}/`})`,
          )
        : undefined

      return db
        .select({
          namespace: connections.namespace,
          providerId: connections.providerId,
          configuration: connections.configuration,
          scopes: connections.scopes,
          expiresAt: connections.expiresAt,
          externalAccountId: connections.externalAccountId,
          externalAccountLabel: connections.externalAccountLabel,
          metadata: connections.metadata,
          createdAt: connections.createdAt,
          updatedAt: connections.updatedAt,
        })
        .from(connections)
        .where(
          and(
            eq(connections.organization, filter.organization ?? ''),
            filter.providerId
              ? eq(connections.providerId, filter.providerId)
              : undefined,
            namespaceFilter,
            connectionScopeFilter(filter.resourceScopes),
          ),
        )
        .orderBy(asc(connections.namespace), asc(connections.providerId))
    },

    async deleteConnection(id) {
      const deleted = await db
        .delete(connections)
        .where(eq(connections.id, id))
        .returning()
      return deleted.length > 0
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
