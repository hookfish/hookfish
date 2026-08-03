import { fileURLToPath, URL } from 'node:url'

/** Absolute path to the SQL migrations shipped with `@template/api`. */
export const migrationsFolder = fileURLToPath(
  new URL('../drizzle', import.meta.url),
)
