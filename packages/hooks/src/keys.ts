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
          namespace: filter.namespace ?? null,
          providerId: filter.provider_id ?? null,
        },
      ] as const,
    connection: (path: string) => [...root, 'connection', path] as const,
    disconnect: () => [...root, 'disconnect'] as const,
  }
}

export type HookfishKeys = ReturnType<typeof createHookfishKeys>
