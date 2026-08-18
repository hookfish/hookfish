import type { Connection, Database } from '../db/types.js'
import { randomToken } from './crypto.js'
import { BrokerError } from './errors.js'
import { formatConnectionPath } from './resource-path.js'

const REFRESH_LOCK_LEASE_MS = 60 * 1000
const REFRESH_LOCK_WAIT_MS = 65 * 1000
const REFRESH_LOCK_POLL_MS = 50

const localRefreshLocks = new WeakMap<Database, Map<string, Promise<void>>>()

async function withLocalRefreshLock<T>(
  db: Database,
  connectionId: string,
  refresh: () => Promise<T>,
): Promise<T> {
  let locks = localRefreshLocks.get(db)
  if (!locks) {
    locks = new Map()
    localRefreshLocks.set(db, locks)
  }

  const previous = locks.get(connectionId) ?? Promise.resolve()
  let releaseQueue: () => void = () => undefined
  const current = new Promise<void>((resolve) => {
    releaseQueue = resolve
  })
  locks.set(connectionId, current)

  await previous
  try {
    return await refresh()
  } finally {
    releaseQueue()
    if (locks.get(connectionId) === current) locks.delete(connectionId)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Use the database lease when the adapter supports it. Older custom adapters
 * represented by plain objects retain process-local coordination until they
 * implement the lease methods. RPC proxies must implement the methods because
 * property access alone cannot advertise remote method availability.
 */
export async function withDatabaseRefreshLock<T>(
  db: Database,
  connection: Connection,
  refresh: () => Promise<T>,
): Promise<T> {
  // This capability check is meaningful for plain local adapters. Durable
  // Object stubs expose arbitrary property reads as RPC method proxies, so the
  // bundled stub contract and its integration test guarantee these methods.
  if (
    !db.acquireConnectionRefreshLock ||
    !db.renewConnectionRefreshLock ||
    !db.releaseConnectionRefreshLock
  ) {
    return withLocalRefreshLock(db, connection.id, refresh)
  }

  const owner = randomToken(18)
  const deadline = Date.now() + REFRESH_LOCK_WAIT_MS

  while (Date.now() < deadline) {
    // Call through the database object. Durable Object stubs expose methods as
    // RPC proxies, so extracting one and calling `.bind(db)` attempts a remote
    // method named `bind` and tries to serialize the stub itself.
    const acquired = await db.acquireConnectionRefreshLock(
      connection.id,
      owner,
      REFRESH_LOCK_LEASE_MS,
    )
    if (acquired) {
      let finished = false
      let leaseLost = false
      let renewalTimer: ReturnType<typeof setTimeout> | undefined
      const scheduleRenewal = () => {
        if (finished) return
        renewalTimer = setTimeout(() => {
          void (async () => {
            try {
              const renewed = await db.renewConnectionRefreshLock!(
                connection.id,
                owner,
                REFRESH_LOCK_LEASE_MS,
              )
              if (!renewed) leaseLost = true
              else scheduleRenewal()
            } catch {
              leaseLost = true
            }
          })()
        }, REFRESH_LOCK_LEASE_MS / 3)
      }
      scheduleRenewal()
      try {
        const result = await refresh()
        if (leaseLost) {
          throw new BrokerError(
            503,
            'refresh_lock_lost',
            'The connection refresh lease was lost. Retry shortly.',
          )
        }
        return result
      } finally {
        finished = true
        if (renewalTimer) clearTimeout(renewalTimer)
        await db.releaseConnectionRefreshLock!(connection.id, owner)
      }
    }

    await delay(REFRESH_LOCK_POLL_MS + Math.floor(Math.random() * 50))
  }

  throw new BrokerError(
    503,
    'refresh_in_progress',
    `Connection "${formatConnectionPath(connection.namespace, connection.providerId)}" is still being refreshed. Retry shortly.`,
  )
}
