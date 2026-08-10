import {
  type MutationFunction,
  type MutationKey,
  mutationOptions,
  type QueryFunction,
  type QueryKey,
  queryOptions,
} from '@tanstack/react-query'
import type {
  AuthorizeConnectionInput,
  ConnectionsFilter,
  HookfishClient,
  ProvidersFilter,
} from './client'
import { type HookfishApiError, throwHookfishApiError } from './errors'
import type { HookfishKeys } from './keys'

function apiQueryOptions<TData, TQueryKey extends QueryKey>(options: {
  queryKey: TQueryKey
  queryFn: QueryFunction<TData, TQueryKey>
}) {
  return queryOptions<TData, HookfishApiError, TData, TQueryKey>(options)
}

function apiMutationOptions<TData, TVariables>(options: {
  mutationKey: MutationKey
  mutationFn: MutationFunction<TData, TVariables>
}) {
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
          const response = await client.oauth.providers.$get(
            { query: {} },
            { init: { signal } },
          )
          if (!response.ok) return throwHookfishApiError(response)
          return response.json()
        },
      }),

    providerSearch: (filter: ProvidersFilter) =>
      apiQueryOptions({
        queryKey: keys.providerSearch(filter),
        queryFn: async ({ signal }) => {
          const response = await client.oauth.providers.$get(
            {
              query: {
                ...filter,
                include_unconfigured:
                  filter.include_unconfigured === undefined
                    ? undefined
                    : filter.include_unconfigured
                      ? 'true'
                      : 'false',
              },
            },
            { init: { signal } },
          )
          if (!response.ok) return throwHookfishApiError(response)
          return response.json()
        },
      }),

    connections: (filter: ConnectionsFilter = {}) =>
      apiQueryOptions({
        queryKey: keys.connections(filter),
        queryFn: async ({ signal }) => {
          const response = await client.oauth.connections.$get(
            { query: filter },
            { init: { signal } },
          )
          if (!response.ok) return throwHookfishApiError(response)
          return response.json()
        },
      }),

    connection: (connectionId: string) =>
      apiQueryOptions({
        queryKey: keys.connection(connectionId),
        queryFn: async ({ signal }) => {
          const response = await client.oauth.connections[
            ':connection_id{.+}'
          ].$get(
            { param: { connection_id: connectionId } },
            { init: { signal } },
          )
          if (!response.ok) return throwHookfishApiError(response)
          return response.json()
        },
      }),

    authorize: () =>
      apiMutationOptions({
        mutationKey: keys.authorize(),
        mutationFn: async (input: AuthorizeConnectionInput) => {
          const { provider, ...json } = input
          const response = await client.oauth.authorize[
            ':provider_path{.+}'
          ].$post({ param: { provider_path: provider }, json })
          if (!response.ok) return throwHookfishApiError(response)
          return response.json()
        },
      }),

    disconnect: () =>
      apiMutationOptions({
        mutationKey: keys.disconnect(),
        mutationFn: async (connectionId: string) => {
          const response = await client.oauth.connections[
            ':connection_id{.+}'
          ].$delete({ param: { connection_id: connectionId } })
          if (!response.ok) return throwHookfishApiError(response)
          return response.json()
        },
      }),
  }
}

export type HookfishOptions = ReturnType<typeof createHookfishOptions>
