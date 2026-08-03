import { defineConfig } from 'drizzle-kit'

/**
 * Migrations are generated against the Postgres dialect and applied to both
 * targets: PGlite locally (`apps/server` Node entrypoint) and hosted Postgres
 * at runtime. One schema, one set of SQL files.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  ...(process.env.DATABASE_URL
    ? { dbCredentials: { url: process.env.DATABASE_URL } }
    : {
        driver: 'pglite',
        dbCredentials: {
          url: process.env.PGLITE_DATA_DIR ?? '../../apps/server/pgdata',
        },
      }),
})
