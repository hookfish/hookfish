import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { betterAuth } from 'better-auth'
import { getMigrations } from 'better-auth/db/migration'
import { organization } from 'better-auth/plugins'

export async function createApplicationAuth(options: {
  baseUrl: string
  databasePath: string
  secret: string
  trustedOrigins: readonly string[]
}) {
  await mkdir(path.dirname(options.databasePath), { recursive: true })
  const database = new DatabaseSync(options.databasePath)
  const auth = betterAuth({
    appName: 'Hookfish',
    baseURL: options.baseUrl,
    database,
    emailAndPassword: { enabled: true },
    plugins: [organization()],
    secret: options.secret,
    trustedOrigins: [...options.trustedOrigins],
  })
  const { runMigrations } = await getMigrations(auth.options)
  await runMigrations()
  return auth
}
