import {
  type UseMutationOptions,
  type UseQueryOptions,
  type QueryKey,
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type {
  AuthorizeConnectionInput,
  AuthorizeConnectionResponse,
  ConnectionResponse,
  ConnectionsFilter,
  ConnectionsResponse,
  DisconnectConnectionResponse,
  ProvidersResponse,
  StatsResponse,
} from './client'
import type { HookfishApiError } from './errors'
import type { HookfishKeys } from './keys'
import type { HookfishOptions } from './options'

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
  connectionId: string,
): Promise<void> {
  queryClient.removeQueries({ queryKey: keys.connection(connectionId) })
  await queryClient.invalidateQueries({ queryKey: keys.connectionsRoot() })
}

export function createReactHooks(options: HookfishOptions, keys: HookfishKeys) {
  function useStats<TData = StatsResponse>(
    overrides?: QueryOverrides<
      StatsResponse,
      TData,
      ReturnType<HookfishKeys['stats']>
    >,
  ) {
    const query = options.stats()
    return useQuery({
      ...overrides,
      queryKey: query.queryKey,
      queryFn: query.queryFn,
    })
  }

  function useProviders<TData = ProvidersResponse>(
    overrides?: QueryOverrides<
      ProvidersResponse,
      TData,
      ReturnType<HookfishKeys['providers']>
    >,
  ) {
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
  ) {
    const query = options.connections(filter)
    return useQuery({
      ...overrides,
      queryKey: query.queryKey,
      queryFn: query.queryFn,
    })
  }

  function useConnection<TData = ConnectionResponse>(
    connectionId: string,
    overrides?: QueryOverrides<
      ConnectionResponse,
      TData,
      ReturnType<HookfishKeys['connection']>
    >,
  ) {
    const query = options.connection(connectionId)
    return useQuery({
      ...overrides,
      queryKey: query.queryKey,
      queryFn: query.queryFn,
    })
  }

  function useAuthorizeConnection(
    overrides?: MutationOverrides<
      AuthorizeConnectionResponse,
      AuthorizeConnectionInput
    >,
  ) {
    return useMutation({ ...options.authorize(), ...overrides })
  }

  function useDisconnectConnection(
    overrides?: MutationOverrides<DisconnectConnectionResponse, string>,
  ) {
    const queryClient = useQueryClient()
    const onSuccess = overrides?.onSuccess

    return useMutation({
      ...options.disconnect(),
      ...overrides,
      async onSuccess(data, connectionId, onMutateResult, context) {
        await invalidateDisconnectedConnection(queryClient, keys, connectionId)
        await onSuccess?.(data, connectionId, onMutateResult, context)
      },
    })
  }

  return {
    useStats,
    useProviders,
    useConnections,
    useConnection,
    useAuthorizeConnection,
    useDisconnectConnection,
  }
}
