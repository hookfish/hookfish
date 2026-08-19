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

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'ManagementApiError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('Accept', 'application/json')
  if (init?.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(`/api/client${path}`, {
    credentials: 'include',
    ...init,
    headers,
  })
  if (response.ok) return response.json()

  const body: unknown = await response.json().catch(() => undefined)
  const error = isRecord(body) && isRecord(body.error) ? body.error : undefined
  throw new ManagementApiError(
    typeof error?.message === 'string'
      ? error.message
      : `Hookfish request failed (${response.status}).`,
    typeof error?.code === 'string' ? error.code : undefined,
  )
}

export async function setConnectionSecret(
  path: string,
  secret: string,
): Promise<void> {
  await request(`/connections/${encodePath(path)}/secret`, {
    method: 'PUT',
    body: JSON.stringify({ secret }),
  })
}

export async function authorizeConnection(
  path: string,
  providerId: string,
  input: AuthorizationInput,
): Promise<PendingAuthorization> {
  const result = await request<{
    path: string
    authorize_url: string
    expires_at: string
  }>(`/connections/${encodePath(path)}/authorize`, {
    method: 'POST',
    body: JSON.stringify({
      ...(input.configuration ? { configuration: input.configuration } : {}),
      ...(input.scopes?.length ? { scopes: input.scopes } : {}),
      ...(input.returnTo ? { return_to: input.returnTo } : {}),
    }),
  })
  return {
    path: result.path,
    providerId,
    authorizeUrl: result.authorize_url,
    expiresAt: result.expires_at,
  }
}
