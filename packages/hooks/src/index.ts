import {
  createHookfishClient,
  type HookfishClient,
  type HookfishClientOptions,
  normalizeApiBaseUrl,
} from './client.js'
import { createReactHooks } from './hooks.js'
import { createHookfishKeys, type HookfishKeys } from './keys.js'
import { createHookfishOptions, type HookfishOptions } from './options.js'

export type CreateHookfishHooksOptions = HookfishClientOptions & {
  /** Distinguishes caches when one QueryClient uses multiple API instances. */
  queryKeyScope?: string
}

/** Annotated so the declaration can name every member of the returned bag. */
export type HookfishHooks = {
  client: HookfishClient
  keys: HookfishKeys
  options: HookfishOptions
} & ReturnType<typeof createReactHooks>

export function createHookfishHooks(
  options: CreateHookfishHooksOptions = {},
): HookfishHooks {
  const { queryKeyScope, ...clientOptions } = options
  const client = createHookfishClient(clientOptions)
  const scope =
    queryKeyScope ?? normalizeApiBaseUrl(clientOptions.baseUrl ?? '/api/client')
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

export {
  type ConnectionResponse,
  type ConnectionsFilter,
  type ConnectionsResponse,
  createHookfishClient,
  type DisconnectConnectionResponse,
  type HookfishClient,
  type HookfishClientOptions,
  normalizeApiBaseUrl,
  type ProvidersResponse,
} from './client.js'
export { HookfishApiError } from './errors.js'
export { createHookfishKeys, type HookfishKeys } from './keys.js'
export { createHookfishOptions, type HookfishOptions } from './options.js'
