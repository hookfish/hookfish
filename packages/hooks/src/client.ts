import type { AppType } from '@hookfish/api'
import {
  type ClientRequestOptions,
  hc,
  type InferRequestType,
  type InferResponseType,
} from 'hono/client'

export type HookfishClient = ReturnType<typeof hc<AppType>>

export type HookfishClientOptions = ClientRequestOptions & {
  /** Full mount point for the Hookfish API. */
  baseUrl?: string
}

export function normalizeApiBaseUrl(baseUrl: string): string {
  if (baseUrl === '/') return ''
  return baseUrl.replace(/\/+$/, '')
}

export function createHookfishClient(
  options: HookfishClientOptions = {},
): HookfishClient {
  const { baseUrl = '/api', ...requestOptions } = options
  return hc<AppType>(normalizeApiBaseUrl(baseUrl), requestOptions)
}

type StatsEndpoint = HookfishClient['stats']['$get']
type ProvidersEndpoint = HookfishClient['oauth']['providers']['$get']
type ConnectionsEndpoint = HookfishClient['oauth']['connections']['$get']
type ConnectionEndpoint =
  HookfishClient['oauth']['connections'][':connection_id{.+}']['$get']
type AuthorizeEndpoint =
  HookfishClient['oauth']['authorize'][':provider_path{.+}']['$post']
type DisconnectEndpoint =
  HookfishClient['oauth']['connections'][':connection_id{.+}']['$delete']

export type StatsResponse = InferResponseType<StatsEndpoint, 200>
export type ProvidersResponse = InferResponseType<ProvidersEndpoint, 200>
export type ProvidersFilter = {
  include_unconfigured?: boolean
  search?: string
  limit?: number
  source?: 'fixed' | 'dynamic'
}
export type ConnectionsResponse = InferResponseType<ConnectionsEndpoint, 200>
export type ConnectionResponse = InferResponseType<ConnectionEndpoint, 200>
export type AuthorizeConnectionResponse = InferResponseType<
  AuthorizeEndpoint,
  200
>
export type DisconnectConnectionResponse = InferResponseType<
  DisconnectEndpoint,
  200
>

export type ConnectionsFilter = InferRequestType<ConnectionsEndpoint>['query']
type AuthorizeRequest = InferRequestType<AuthorizeEndpoint>

export type AuthorizeConnectionInput = AuthorizeRequest['json'] & {
  provider: AuthorizeRequest['param']['provider_path']
}
