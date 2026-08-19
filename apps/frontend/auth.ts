import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ApplicationAuthProvider } from '@hookfish/client'
import { betterAuth } from 'better-auth'
import { getMigrations } from 'better-auth/db/migration'

export type ApplicationSession = {
  user: { id: string }
  session: object
}

/**
 * Map every verified application session to the frontend's constant Hookfish
 * subtree. Change this method when the host needs a different path convention.
 */
export function resolveBasePath(_session: ApplicationSession): string {
  return process.env.HOOKFISH_BASE_PATH?.trim() || 'global'
}

function authDatabasePath(): string {
  return (
    process.env.BETTER_AUTH_DATABASE?.trim() ||
    path.join(homedir(), '.hookfish', 'frontend-auth.sqlite')
  )
}

function authSecret(): string {
  const configured = process.env.BETTER_AUTH_SECRET?.trim()
  if (configured) return configured
  const apiKey = process.env.HOOKFISH_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('BETTER_AUTH_SECRET or HOOKFISH_API_KEY is required.')
  }
  return createHash('sha256')
    .update(`hookfish-frontend-auth\0${apiKey}`)
    .digest('base64url')
}

const databasePath = authDatabasePath()
if (!existsSync(path.dirname(databasePath))) {
  mkdirSync(path.dirname(databasePath), { recursive: true })
}

export const auth = betterAuth({
  appName: 'Hookfish',
  baseURL: process.env.HOOKFISH_FRONTEND_URL,
  database: new DatabaseSync(databasePath),
  emailAndPassword: { enabled: true },
  secret: authSecret(),
})

const authReady = getMigrations(auth.options).then(({ runMigrations }) =>
  runMigrations(),
)

function errorResponse(
  status: number,
  code: string,
  message: string,
): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function handleAuthRequest(request: Request): Promise<Response> {
  await authReady
  return auth.handler(request)
}

export const applicationAuth: ApplicationAuthProvider = {
  async authenticate(request) {
    await authReady
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session) {
      return {
        authenticated: false,
        response: errorResponse(
          401,
          'application_auth_required',
          'Sign in to access Hookfish connections.',
        ),
      }
    }
    return {
      authenticated: true,
      principal: {
        subject: session.user.id,
        basePath: resolveBasePath(session),
      },
    }
  },
}
