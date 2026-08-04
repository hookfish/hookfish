import type { ConnectionsFilter } from './client'

export function createHookfishKeys(scope: string) {
  const root = ['hookfish', scope] as const

  return {
    all: root,
    stats: () => [...root, 'stats'] as const,
    providers: () => [...root, 'providers'] as const,
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
