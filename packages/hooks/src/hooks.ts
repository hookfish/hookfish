import {
  type QueryClient,
  type QueryKey,
  type UseMutationOptions,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type {
  ConnectionResponse,
  ConnectionsFilter,
  ConnectionsResponse,
  DisconnectConnectionResponse,
  ProvidersResponse,
} from './client.js'
import type { HookfishApiError } from './errors.js'
import type { HookfishKeys } from './keys.js'
import type { HookfishOptions } from './options.js'

type QueryOverrides<TQueryFnData, TData, TQueryKey extends QueryKey> = Omit<
  UseQueryOptions<TQueryFnData, HookfishApiError, TData, TQueryKey>,
  'queryFn' | 'queryKey'
>

type MutationOverrides<TData, TVariables> = Omit<
  UseMutationOptions<TData, HookfishApiError, TVariables>,
  'mutationFn' | 'mutationKey'
>

export async function invalidateDisconnectedConnection(
  queryClient: QueryClient,
  keys: HookfishKeys,
  path: string,
): Promise<void> {
  queryClient.removeQueries({ queryKey: keys.connection(path) })
  await queryClient.invalidateQueries({ queryKey: keys.connectionsRoot() })
}

export function createReactHooks(options: HookfishOptions, keys: HookfishKeys) {
  function useProviders<TData = ProvidersResponse>(
    overrides?: QueryOverrides<
      ProvidersResponse,
      TData,
      ReturnType<HookfishKeys['providers']>
    >,
  ): UseQueryResult<TData, HookfishApiError> {
    const query = options.providers()
    return useQuery({
      ...overrides,
      queryKey: query.queryKey,
      queryFn: query.queryFn,
    })
  }

  function useConnections<TData = ConnectionsResponse>(
    filter: ConnectionsFilter = {},
    overrides?: QueryOverrides<
      ConnectionsResponse,
      TData,
      ReturnType<HookfishKeys['connections']>
    >,
  ): UseQueryResult<TData, HookfishApiError> {
    const query = options.connections(filter)
    return useQuery({
      ...overrides,
      queryKey: query.queryKey,
      queryFn: query.queryFn,
    })
  }

  function useConnection<TData = ConnectionResponse>(
    path: string,
    overrides?: QueryOverrides<
      ConnectionResponse,
      TData,
      ReturnType<HookfishKeys['connection']>
    >,
  ): UseQueryResult<TData, HookfishApiError> {
    const query = options.connection(path)
    return useQuery({
      ...overrides,
      queryKey: query.queryKey,
      queryFn: query.queryFn,
    })
  }

  function useDisconnectConnection(
    overrides?: MutationOverrides<DisconnectConnectionResponse, string>,
  ): UseMutationResult<DisconnectConnectionResponse, HookfishApiError, string> {
    const queryClient = useQueryClient()
    const onSuccess = overrides?.onSuccess

    return useMutation({
      ...options.disconnect(),
      ...overrides,
      async onSuccess(data, path, onMutateResult, context) {
        await invalidateDisconnectedConnection(queryClient, keys, path)
        await onSuccess?.(data, path, onMutateResult, context)
      },
    })
  }

  return {
    useProviders,
    useConnections,
    useConnection,
    useDisconnectConnection,
  }
}
