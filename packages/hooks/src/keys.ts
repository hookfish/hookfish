import type { ConnectionsFilter, ProvidersFilter } from './client'

export function createHookfishKeys(scope: string) {
  const root = ['hookfish', scope] as const

  return {
    all: root,
    stats: () => [...root, 'stats'] as const,
    providers: () => [...root, 'providers'] as const,
    providerSearch: (filter: ProvidersFilter) =>
      [
        ...root,
        'providers',
        {
          includeUnconfigured: filter.include_unconfigured ?? null,
          limit: filter.limit ?? null,
          search: filter.search ?? null,
          source: filter.source ?? null,
        },
      ] as const,
    connectionsRoot: () => [...root, 'connections'] as const,
    connections: (filter: ConnectionsFilter = {}) =>
      [
        ...root,
        'connections',
        {
          provider: filter.provider ?? null,
          connectionIdPrefix: filter.connection_id_prefix ?? null,
        },
      ] as const,
    connection: (connectionId: string) =>
      [...root, 'connection', connectionId] as const,
    authorize: () => [...root, 'authorize'] as const,
    disconnect: () => [...root, 'disconnect'] as const,
  }
}

export type HookfishKeys = ReturnType<typeof createHookfishKeys>
