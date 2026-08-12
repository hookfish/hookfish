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
        Object.fromEntries(
          Object.entries(filter)
            .filter(([, value]) => value !== undefined)
            .sort(([left], [right]) => left.localeCompare(right)),
        ),
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
