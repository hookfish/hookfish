import { fileURLToPath, URL } from 'node:url'

/** Absolute path to the SQL migrations shipped with `@hookfish/api`. */
export const migrationsFolder = fileURLToPath(
  new URL('../drizzle', import.meta.url),
)
