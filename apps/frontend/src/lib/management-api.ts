import { backendUrl } from './api-url'

export type SecretMetadata = {
  path: string
  created_at: string
  updated_at: string
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

async function managementRequest<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('Accept', 'application/json')
  headers.set('Authorization', `Bearer ${token}`)
  if (init?.body) headers.set('Content-Type', 'application/json')

  const response = await fetch(`${backendUrl}/api${path}`, {
    ...init,
    headers,
  })
  if (response.ok) return response.json()
  const body: unknown = await response.json().catch(() => undefined)
  const error =
    typeof body === 'object' && body !== null && 'error' in body
      ? body.error
      : undefined
  const message =
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
      ? error.message
      : `Hookfish request failed (${response.status}).`
  throw new Error(message)
}

export async function listSecrets(
  token: string,
  pathPrefix?: string,
): Promise<SecretMetadata[]> {
  const query = pathPrefix
    ? `?path_prefix=${encodeURIComponent(pathPrefix)}`
    : ''
  const data = await managementRequest<{ secrets: SecretMetadata[] }>(
    token,
    `/secrets${query}`,
  )
  return data.secrets
}

export async function storeSecret(
  token: string,
  path: string,
  value: string,
): Promise<SecretMetadata> {
  const data = await managementRequest<{ secret: SecretMetadata }>(
    token,
    `/secrets/${encodePath(path)}`,
    { method: 'PUT', body: JSON.stringify({ value }) },
  )
  return data.secret
}

export async function deleteSecret(token: string, path: string): Promise<void> {
  await managementRequest(token, `/secrets/${encodePath(path)}`, {
    method: 'DELETE',
  })
}
