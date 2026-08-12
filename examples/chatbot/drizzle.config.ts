import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './lib/auth-schema.ts',
  out: './drizzle',
  dbCredentials: {
    url:
      process.env.POSTGRES_URL?.trim() ||
      process.env.DATABASE_URL?.trim() ||
      'postgresql://postgres:postgres@127.0.0.1:54329/postgres',
  },
})
