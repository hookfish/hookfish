import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from 'drizzle-orm'
import {
  accessGrants,
  brokerAccessTokens,
  connections,
  type DrizzleDatabase,
  oauthStates,
} from './schema.js'
import type { Database } from './types.js'

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

    async supersedeOAuthStates(namespace, providerId) {
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

    async getConnection(namespace, providerId) {
      const [connection] = await db
        .select()
        .from(connections)
        .where(
          and(
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
          target: [connections.namespace, connections.providerId],
        })
        .returning()
      if (inserted) return inserted

      const [existing] = await db
        .select()
        .from(connections)
        .where(
          and(
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

    async acquireConnectionRefreshLock(id, owner, leaseDurationMs) {
      const now = sql<Date>`CURRENT_TIMESTAMP`
      const expiresAt = sql<Date>`CURRENT_TIMESTAMP + (${leaseDurationMs} * INTERVAL '1 millisecond')`
      const claimed = await db
        .update(connections)
        .set({ refreshLockOwner: owner, refreshLockExpiresAt: expiresAt })
        .where(
          and(
            eq(connections.id, id),
            or(
              isNull(connections.refreshLockOwner),
              lte(connections.refreshLockExpiresAt, now),
            ),
          ),
        )
        .returning()
      return claimed.length > 0
    },

    async renewConnectionRefreshLock(id, owner, leaseDurationMs) {
      const expiresAt = sql<Date>`CURRENT_TIMESTAMP + (${leaseDurationMs} * INTERVAL '1 millisecond')`
      const renewed = await db
        .update(connections)
        .set({ refreshLockExpiresAt: expiresAt })
        .where(
          and(eq(connections.id, id), eq(connections.refreshLockOwner, owner)),
        )
        .returning()
      return renewed.length > 0
    },

    async releaseConnectionRefreshLock(id, owner) {
      await db
        .update(connections)
        .set({ refreshLockOwner: null, refreshLockExpiresAt: null })
        .where(
          and(eq(connections.id, id), eq(connections.refreshLockOwner, owner)),
        )
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

    async getValidBrokerAccessToken(tokenIdHash, grantId, now) {
      const [row] = await db
        .select({ token: brokerAccessTokens, grant: accessGrants })
        .from(brokerAccessTokens)
        .innerJoin(
          accessGrants,
          eq(brokerAccessTokens.grantId, accessGrants.id),
        )
        .where(
          and(
            eq(brokerAccessTokens.tokenIdHash, tokenIdHash),
            eq(brokerAccessTokens.grantId, grantId),
            gt(accessGrants.expiresAt, now),
          ),
        )
        .limit(1)
      return row
        ? {
            ...row.token,
            grant: row.grant,
          }
        : undefined
    },

    async purgeExpiredBrokerAccessTokens(before) {
      await db.delete(accessGrants).where(lte(accessGrants.expiresAt, before))
    },

    async createBrokerAccessToken(input) {
      return db.transaction(async (tx) => {
        const existing = await tx
          .select({ name: brokerAccessTokens.name })
          .from(brokerAccessTokens)
          .where(
            or(
              eq(brokerAccessTokens.name, input.name),
              eq(brokerAccessTokens.tokenIdHash, input.tokenIdHash),
            ),
          )
          .limit(1)
        if (existing.length > 0) return false

        await tx.insert(accessGrants).values({
          id: input.grantId,
          parentGrantId: input.parentGrantId,
          scopes: input.scopes,
          expiresAt: input.expiresAt,
        })
        const inserted = await tx
          .insert(brokerAccessTokens)
          .values({
            name: input.name,
            tokenIdHash: input.tokenIdHash,
            grantId: input.grantId,
          })
          .onConflictDoNothing()
          .returning()
        if (inserted.length > 0) return true

        await tx.delete(accessGrants).where(eq(accessGrants.id, input.grantId))
        return false
      })
    },

    async listBrokerAccessTokenNames() {
      const tokens = await db
        .select({ name: brokerAccessTokens.name })
        .from(brokerAccessTokens)
        .orderBy(asc(brokerAccessTokens.name))
      return tokens.map(({ name }) => name)
    },

    async deleteBrokerAccessTokenGrant(name) {
      const deleted = await db
        .delete(accessGrants)
        .where(
          inArray(
            accessGrants.id,
            db
              .select({ grantId: brokerAccessTokens.grantId })
              .from(brokerAccessTokens)
              .where(eq(brokerAccessTokens.name, name)),
          ),
        )
        .returning()
      return deleted.length > 0
    },
  }
}
