import { backendUrl } from './api-url'

export type SecretMetadata = {
  path: string
  created_at: string
  updated_at: string
}

export type ManagedProvider = {
  id: string
  template: string | null
  label: string
  source: 'fixed' | 'dynamic'
  configured: boolean
  enabled: boolean
  credentials: {
    mode: 'inherit' | 'custom'
    client_id: string | null
  } | null
  created_at: string | null
  updated_at: string | null
}

export type StoreProviderInput = {
  id: string
  template: string
  label?: string
  clientId: string
  clientSecret: string
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

  const body = await response.json().catch(() => undefined)
  const message = body?.error?.message
  throw new Error(
    typeof message === 'string'
      ? message
      : `Hookfish request failed (${response.status}).`,
  )
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

export async function listManagedProviders(
  token: string,
): Promise<ManagedProvider[]> {
  const data = await managementRequest<{ providers: ManagedProvider[] }>(
    token,
    '/admin/providers',
  )
  return data.providers
}

export async function storeManagedProvider(
  token: string,
  input: StoreProviderInput,
): Promise<ManagedProvider> {
  const data = await managementRequest<{ provider: ManagedProvider }>(
    token,
    `/admin/providers/${encodeURIComponent(input.id)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        template: input.template,
        ...(input.label ? { label: input.label } : {}),
        credentials: {
          mode: 'custom',
          client_id: input.clientId,
          client_secret: input.clientSecret,
        },
        enabled: true,
      }),
    },
  )
  return data.provider
}

export async function deleteManagedProvider(
  token: string,
  providerId: string,
): Promise<void> {
  await managementRequest(
    token,
    `/admin/providers/${encodeURIComponent(providerId)}`,
    { method: 'DELETE' },
  )
}
