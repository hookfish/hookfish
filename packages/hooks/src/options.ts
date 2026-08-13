import {
  type MutationFunction,
  type MutationKey,
  mutationOptions,
  type QueryFunction,
  type QueryKey,
  queryOptions,
  type UseMutationOptions,
  type UseQueryOptions,
} from '@tanstack/react-query'
import type { ConnectionsFilter, HookfishClient } from './client.js'
import { type HookfishApiError, throwHookfishApiError } from './errors.js'
import type { HookfishKeys } from './keys.js'

function apiQueryOptions<TData, TQueryKey extends QueryKey>(options: {
  queryKey: TQueryKey
  queryFn: QueryFunction<TData, TQueryKey>
}): UseQueryOptions<TData, HookfishApiError, TData, TQueryKey> & {
  queryKey: TQueryKey
} {
  return queryOptions<TData, HookfishApiError, TData, TQueryKey>(options)
}

function apiMutationOptions<TData, TVariables>(options: {
  mutationKey: MutationKey
  mutationFn: MutationFunction<TData, TVariables>
}): UseMutationOptions<TData, HookfishApiError, TVariables> {
  return mutationOptions<TData, HookfishApiError, TVariables>(options)
}

export function createHookfishOptions(
  client: HookfishClient,
  keys: HookfishKeys,
) {
  return {
    stats: () =>
      apiQueryOptions({
        queryKey: keys.stats(),
        queryFn: async ({ signal }) => {
          const response = await client.stats.$get(undefined, {
            init: { signal },
          })
          if (!response.ok) return throwHookfishApiError(response)
          return response.json()
        },
      }),

    providers: () =>
      apiQueryOptions({
        queryKey: keys.providers(),
        queryFn: async ({ signal }) => {
          const response = await client.connections.providers.$get(undefined, {
            init: { signal },
          })
          if (!response.ok) return throwHookfishApiError(response)
          return response.json()
        },
      }),

    connections: (filter: ConnectionsFilter = {}) =>
      apiQueryOptions({
        queryKey: keys.connections(filter),
        queryFn: async ({ signal }) => {
          const response = await client.connections.$get(
            { query: filter },
            { init: { signal } },
          )
          if (!response.ok) return throwHookfishApiError(response)
          return response.json()
        },
      }),

    connection: (path: string) =>
      apiQueryOptions({
        queryKey: keys.connection(path),
        queryFn: async ({ signal }) => {
          const response = await client.connections.entry[
            ':connection_path{.+}'
          ].$get({ param: { connection_path: path } }, { init: { signal } })
          if (!response.ok) return throwHookfishApiError(response)
          return response.json()
        },
      }),

    disconnect: () =>
      apiMutationOptions({
        mutationKey: keys.disconnect(),
        mutationFn: async (path: string) => {
          const response = await client.connections.entry[
            ':connection_path{.+}'
          ].$delete({ param: { connection_path: path } })
          if (!response.ok) return throwHookfishApiError(response)
          return response.json()
        },
      }),
  }
}

export type HookfishOptions = ReturnType<typeof createHookfishOptions>
