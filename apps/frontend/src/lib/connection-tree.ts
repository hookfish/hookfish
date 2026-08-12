import type { ConnectionsResponse } from '@hookfish/hooks'

type Connection = ConnectionsResponse['connections'][number]

type ConnectionFolder = {
  name: string
  path: string
  itemCount: number
}

type ConnectionDirectory = {
  folders: ConnectionFolder[]
  connections: Connection[]
}

function joinConnectionPath(path: string, name: string): string {
  return path ? `${path}/${name}` : name
}

export function connectionDirectory(
  connections: Connection[],
  currentPath: string,
): ConnectionDirectory {
  const prefix = currentPath ? `${currentPath}/` : ''
  const folders = new Map<string, ConnectionFolder>()
  const directConnections: Connection[] = []

  for (const connection of connections) {
    if (currentPath && connection.path === currentPath) continue
    if (!connection.path.startsWith(prefix)) continue

    const remainder = connection.path.slice(prefix.length)
    const separatorIndex = remainder.indexOf('/')

    if (separatorIndex === -1) {
      directConnections.push(connection)
      continue
    }

    const name = remainder.slice(0, separatorIndex)
    const existing = folders.get(name)

    if (existing) {
      existing.itemCount += 1
    } else {
      folders.set(name, {
        name,
        path: joinConnectionPath(currentPath, name),
        itemCount: 1,
      })
    }
  }

  return {
    folders: [...folders.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    connections: directConnections.sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
  }
}
