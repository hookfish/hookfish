import { createHookfishClient, type HookfishClient } from '@hookfish/hooks'
import { backendUrl } from './api-url'

const managementClient = createHookfishClient({
  baseUrl: `${backendUrl}/api`,
})

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
  configuration: Record<string, unknown> | null
  created_at: string | null
  updated_at: string | null
}

type StoreProviderBase = {
  id: string
  template: string
  label?: string
}

type StoreOAuthProviderInput = {
  type: 'oauth'
  clientId: string
  clientSecret: string
}

type StoreMcpProviderInput = {
  type: 'mcp'
  resourceUrl: string
  scopes: string[]
  clientId?: string
  clientSecret?: string
}

export type StoreProviderInput = StoreProviderBase &
  (StoreOAuthProviderInput | StoreMcpProviderInput)

type StoreProviderBody = Parameters<
  HookfishClient['admin']['providers'][':provider_id']['$put']
>[0]['json']

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

  return throwManagementError(response)
}

async function throwManagementError(response: Response): Promise<never> {
  const body = await response.json().catch(() => undefined)
  const message = body?.error?.message
  throw new Error(
    typeof message === 'string'
      ? message
      : `Hookfish request failed (${response.status}).`,
  )
}

function managementRequestOptions(token: string) {
  return {
    headers: { Authorization: `Bearer ${token}` },
  }
}

function storeProviderBody(input: StoreProviderInput): StoreProviderBody {
  const base = {
    template: input.template,
    ...(input.label ? { label: input.label } : {}),
    enabled: true,
  }

  if (input.type === 'mcp') {
    return {
      ...base,
      configuration: {
        resource_url: input.resourceUrl,
        scopes: input.scopes,
      },
      credentials: input.clientId
        ? {
            mode: 'custom',
            client_id: input.clientId,
            ...(input.clientSecret
              ? { client_secret: input.clientSecret }
              : {}),
          }
        : { mode: 'register' },
    }
  }

  return {
    ...base,
    credentials: {
      mode: 'custom',
      client_id: input.clientId,
      client_secret: input.clientSecret,
    },
  }
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
  const response = await managementClient.admin.providers.$get(
    undefined,
    managementRequestOptions(token),
  )
  if (!response.ok) return throwManagementError(response)
  const data = await response.json()
  return data.providers
}

export async function storeManagedProvider(
  token: string,
  input: StoreProviderInput,
): Promise<ManagedProvider> {
  const response = await managementClient.admin.providers[':provider_id'].$put(
    {
      param: { provider_id: input.id },
      json: storeProviderBody(input),
    },
    managementRequestOptions(token),
  )
  if (!response.ok) return throwManagementError(response)
  const data = await response.json()
  return data.provider
}

export async function deleteManagedProvider(
  token: string,
  providerId: string,
): Promise<void> {
  const response = await managementClient.admin.providers[
    ':provider_id'
  ].$delete(
    { param: { provider_id: providerId } },
    managementRequestOptions(token),
  )
  if (!response.ok) return throwManagementError(response)
}
