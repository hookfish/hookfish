import type { AppType } from '@hookfish/api'
import { hc, type InferRequestType, type InferResponseType } from 'hono/client'

type RawClient = ReturnType<typeof hc<AppType>>
type ProvidersEndpoint = RawClient['connections']['providers']['$get']
type ConnectionsEndpoint = RawClient['connections']['$get']
type ConnectionEndpoint =
  RawClient['connections']['entry'][':connection_path{.+}']['$get']
type DisconnectEndpoint =
  RawClient['connections']['entry'][':connection_path{.+}']['$delete']

export type ProvidersResponse = InferResponseType<ProvidersEndpoint, 200>
export type ConnectionsResponse = InferResponseType<ConnectionsEndpoint, 200>
export type ConnectionResponse = InferResponseType<ConnectionEndpoint, 200>
export type DisconnectConnectionResponse = InferResponseType<
  DisconnectEndpoint,
  200
>
export type ConnectionsFilter = InferRequestType<ConnectionsEndpoint>['query']

type TypedResponse<T> = Omit<Response, 'json'> & {
  json(): Promise<T>
}

export type HookfishClientOptions = {
  /** Application facade mount point. @default "/api/client" */
  baseUrl?: string
  /** Application-session headers. Never pass a Hookfish broker credential. */
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>)
  fetch?: typeof globalThis.fetch
}

export type HookfishClient = {
  providers(options?: {
    signal?: AbortSignal
  }): Promise<TypedResponse<ProvidersResponse>>
  listConnections(
    filter?: ConnectionsFilter,
    options?: { signal?: AbortSignal },
  ): Promise<TypedResponse<ConnectionsResponse>>
  getConnection(
    path: string,
    options?: { signal?: AbortSignal },
  ): Promise<TypedResponse<ConnectionResponse>>
  disconnectConnection(
    path: string,
    options?: { signal?: AbortSignal },
  ): Promise<TypedResponse<DisconnectConnectionResponse>>
}

export function normalizeApiBaseUrl(baseUrl: string): string {
  if (baseUrl === '/') return ''
  return baseUrl.replace(/\/+$/, '')
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

export function createHookfishClient(
  options: HookfishClientOptions = {},
): HookfishClient {
  const baseUrl = normalizeApiBaseUrl(options.baseUrl ?? '/api/client')
  const requestFetch = options.fetch ?? globalThis.fetch

  async function request<T>(
    pathname: string,
    init: RequestInit = {},
  ): Promise<TypedResponse<T>> {
    const configuredHeaders =
      typeof options.headers === 'function'
        ? await options.headers()
        : options.headers
    const headers = new Headers(configuredHeaders)
    new Headers(init.headers).forEach((value, key) => {
      headers.set(key, value)
    })
    headers.set('Accept', 'application/json')
    return requestFetch(`${baseUrl}${pathname}`, {
      credentials: 'include',
      ...init,
      headers,
    })
  }

  return {
    providers: ({ signal } = {}) => request('/providers', { signal }),
    listConnections: (filter = {}, { signal } = {}) => {
      const query = new URLSearchParams()
      if (filter.namespace) query.set('namespace', filter.namespace)
      if (filter.provider_id) query.set('provider_id', filter.provider_id)
      const suffix = query.size ? `?${query}` : ''
      return request(`/connections${suffix}`, { signal })
    },
    getConnection: (path, { signal } = {}) =>
      request(`/connections/${encodePath(path)}`, { signal }),
    disconnectConnection: (path, { signal } = {}) =>
      request(`/connections/${encodePath(path)}`, {
        method: 'DELETE',
        signal,
      }),
  }
}
