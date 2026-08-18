import type { Connection, Database } from '../db/types.js'
import { randomToken } from './crypto.js'
import { BrokerError } from './errors.js'
import { formatConnectionPath } from './resource-path.js'

const REFRESH_LOCK_LEASE_MS = 60 * 1000
const REFRESH_LOCK_WAIT_MS = 65 * 1000
const REFRESH_LOCK_POLL_MS = 50

export type RefreshCoordinatorRequest<Bindings extends object = object> = {
  /** Stable per-connection key. Prefix it with a deployment ID in shared lock stores. */
  key: string
  connectionId: string
  connectionPath: string
  bindings: Bindings
}

/**
 * Runs one refresh operation under an application-supplied distributed lock.
 * The implementation owns acquisition, waiting, crash expiry, and release.
 */
export type RefreshCoordinator<Bindings extends object = object> = <T>(
  request: RefreshCoordinatorRequest<Bindings>,
  refresh: () => Promise<T>,
) => Promise<T>

export type BoundRefreshCoordinator = <T>(
  connection: Connection,
  refresh: () => Promise<T>,
) => Promise<T>

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
 * retain process-local coordination until they implement the lease methods.
 */
export async function withDatabaseRefreshLock<T>(
  db: Database,
  connection: Connection,
  refresh: () => Promise<T>,
): Promise<T> {
  const acquire = db.acquireConnectionRefreshLock?.bind(db)
  const renew = db.renewConnectionRefreshLock?.bind(db)
  const release = db.releaseConnectionRefreshLock?.bind(db)
  if (!acquire || !renew || !release) {
    return withLocalRefreshLock(db, connection.id, refresh)
  }

  const owner = randomToken(18)
  const deadline = Date.now() + REFRESH_LOCK_WAIT_MS

  while (Date.now() < deadline) {
    const acquired = await acquire(connection.id, owner, REFRESH_LOCK_LEASE_MS)
    if (acquired) {
      let finished = false
      let leaseLost = false
      let renewalTimer: ReturnType<typeof setTimeout> | undefined
      const scheduleRenewal = () => {
        if (finished) return
        renewalTimer = setTimeout(() => {
          void (async () => {
            try {
              const renewed = await renew(
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
        await release(connection.id, owner)
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
