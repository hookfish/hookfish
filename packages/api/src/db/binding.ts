import type { Database } from './schema'

export type MaybePromise<T> = T | Promise<T>

/**
 * Resolves the database available to one request.
 *
 * Bindings are deliberately opaque to the API. A Node adapter can ignore them,
 * while an edge adapter can read a runtime binding (for example, a Hyperdrive
 * connection) without coupling Hookfish to that runtime.
 */
export interface DatabaseBinding<Bindings extends object = object> {
  getDatabase(bindings: Bindings): MaybePromise<Database>
}

/** A ready Drizzle database is also accepted for simple and embedded hosts. */
export type DatabaseInput<Bindings extends object = object> =
  | Database
  | Promise<Database>
  | DatabaseBinding<Bindings>

export function defineDatabase<Bindings extends object = object>(
  getDatabase: (bindings: Bindings) => MaybePromise<Database>,
): DatabaseBinding<Bindings> {
  return { getDatabase }
}

function isDatabaseBinding<Bindings extends object>(
  value: DatabaseInput<Bindings>,
): value is DatabaseBinding<Bindings> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getDatabase' in value &&
    typeof value.getDatabase === 'function'
  )
}

export async function resolveDatabase<Bindings extends object>(
  input: DatabaseInput<Bindings>,
  bindings: Bindings,
): Promise<Database> {
  if (isDatabaseBinding(input)) return input.getDatabase(bindings)
  return input
}
