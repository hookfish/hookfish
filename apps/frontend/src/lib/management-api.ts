import { backendUrl } from './api-url'

export type AuthorizationInput = {
  configuration?: Record<string, unknown>
  scopes?: string[]
  returnTo?: string
}

export type PendingAuthorization = {
  path: string
  providerId: string
  authorizeUrl: string
  expiresAt: string
}

class ManagementApiError extends Error {
  readonly code: string | undefined
  readonly details: Record<string, unknown> | undefined

  constructor(
    message: string,
    code?: string,
    details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ManagementApiError'
    this.code = code
    this.details = details
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

async function request<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('Accept', 'application/json')
  headers.set('Authorization', `Bearer ${token}`)
  if (init?.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${backendUrl}/api${path}`, { ...init, headers })
  if (response.ok) return response.json()

  const body: unknown = await response.json().catch(() => undefined)
  const error = isRecord(body) && isRecord(body.error) ? body.error : undefined
  const message = error?.message
  throw new ManagementApiError(
    typeof message === 'string'
      ? message
      : `Hookfish request failed (${response.status}).`,
    typeof error?.code === 'string' ? error.code : undefined,
    error,
  )
}

export async function setConnectionSecret(
  token: string,
  path: string,
  secret: string,
): Promise<void> {
  await request(token, `/connections/secret/${encodePath(path)}`, {
    method: 'PUT',
    body: JSON.stringify({ secret }),
  })
}

export async function authorizeConnection(
  token: string,
  path: string,
  providerId: string,
  input: AuthorizationInput,
): Promise<PendingAuthorization> {
  try {
    await request(token, `/connections/authorize/${encodePath(path)}`, {
      method: 'POST',
      body: JSON.stringify({
        ...(input.configuration ? { configuration: input.configuration } : {}),
        ...(input.scopes?.length ? { scopes: input.scopes } : {}),
        ...(input.returnTo ? { return_to: input.returnTo } : {}),
      }),
    })
  } catch (error) {
    if (
      error instanceof ManagementApiError &&
      error.code === 'authorization_required' &&
      typeof error.details?.authorize_url === 'string' &&
      typeof error.details.expires_at === 'string'
    ) {
      return {
        path,
        providerId,
        authorizeUrl: error.details.authorize_url,
        expiresAt: error.details.expires_at,
      }
    }
    throw error
  }
  throw new Error('Hookfish did not return an authorization URL.')
}
