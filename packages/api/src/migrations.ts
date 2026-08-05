import { fileURLToPath, URL } from 'node:url'

/** Resolve the SQL migrations shipped with `@hookfish/api` when a Node migrator runs. */
export function migrationsFolder(): string {
  return fileURLToPath(new URL('../drizzle', import.meta.url))
}
