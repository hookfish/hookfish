import {
  createHookfishClient,
  type HookfishClientOptions,
  normalizeApiBaseUrl,
} from './client'
import { createReactHooks } from './hooks'
import { createHookfishKeys } from './keys'
import { createHookfishOptions } from './options'

export type CreateHookfishHooksOptions = HookfishClientOptions & {
  /** Distinguishes caches when one QueryClient uses multiple API instances. */
  queryKeyScope?: string
}

export function createHookfishHooks(options: CreateHookfishHooksOptions = {}) {
  const { queryKeyScope, ...clientOptions } = options
  const client = createHookfishClient(clientOptions)
  const scope =
    queryKeyScope ?? normalizeApiBaseUrl(clientOptions.baseUrl ?? '/api')
  const keys = createHookfishKeys(scope)
  const requestOptions = createHookfishOptions(client, keys)
  const hooks = createReactHooks(requestOptions, keys)

  return {
    client,
    keys,
    options: requestOptions,
    ...hooks,
  }
}

export type HookfishHooks = ReturnType<typeof createHookfishHooks>

export {
  createHookfishClient,
  normalizeApiBaseUrl,
  type AuthorizeConnectionInput,
  type AuthorizeConnectionResponse,
  type ConnectionResponse,
  type ConnectionsFilter,
  type ConnectionsResponse,
  type DisconnectConnectionResponse,
  type HookfishClient,
  type HookfishClientOptions,
  type ProviderListQueryValue,
  type ProvidersResponse,
  type ProvidersFilter,
  type StatsResponse,
} from './client'
export { HookfishApiError } from './errors'
export { createHookfishKeys, type HookfishKeys } from './keys'
export { createHookfishOptions, type HookfishOptions } from './options'
