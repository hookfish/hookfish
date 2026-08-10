import type { ConnectionsResponse } from '@hookfish/hooks'

export type Connection = ConnectionsResponse['connections'][number]

export type ConnectionFolder = {
  name: string
  path: string
  connectionCount: number
}

export type ConnectionDirectory = {
  folders: ConnectionFolder[]
  connections: Connection[]
}

const CONNECTION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export function joinConnectionPath(path: string, name: string): string {
  return path ? `${path}/${name}` : name
}

export function validateConnectionName(name: string): string | undefined {
  if (!name) return 'Enter a connection name.'
  if (!CONNECTION_NAME_PATTERN.test(name)) {
    return 'Use 1–64 letters, numbers, dots, underscores, or hyphens.'
  }
  if (name === '.' || name === '..') return 'Choose another name.'
  return undefined
}

export function validateConnectionPath(path: string): string | undefined {
  if (!path) return undefined
  if (path.startsWith('/') || path.endsWith('/') || path.includes('//')) {
    return 'Use path segments without leading, trailing, or repeated slashes.'
  }

  for (const segment of path.split('/')) {
    const error = validateConnectionName(segment)
    if (error) return `Invalid path segment “${segment}”. ${error}`
  }

  return undefined
}

export function connectionDirectory(
  connections: Connection[],
  currentPath: string,
  localFolders: string[] = [],
): ConnectionDirectory {
  const prefix = currentPath ? `${currentPath}/` : ''
  const folders = new Map<string, ConnectionFolder>()
  const directConnections: Connection[] = []

  for (const folderPath of localFolders) {
    if (!folderPath.startsWith(prefix) || folderPath === currentPath) continue

    const remainder = folderPath.slice(prefix.length)
    const name = remainder.split('/')[0]
    if (!name || folders.has(name)) continue

    folders.set(name, {
      name,
      path: joinConnectionPath(currentPath, name),
      connectionCount: 0,
    })
  }

  for (const connection of connections) {
    if (currentPath && connection.connection_id === currentPath) continue
    if (!connection.connection_id.startsWith(prefix)) continue

    const remainder = connection.connection_id.slice(prefix.length)
    const separatorIndex = remainder.indexOf('/')

    if (separatorIndex === -1) {
      directConnections.push(connection)
      continue
    }

    const name = remainder.slice(0, separatorIndex)
    const existing = folders.get(name)

    if (existing) {
      existing.connectionCount += 1
    } else {
      folders.set(name, {
        name,
        path: joinConnectionPath(currentPath, name),
        connectionCount: 1,
      })
    }
  }

  return {
    folders: [...folders.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    connections: directConnections.sort((left, right) =>
      left.connection_id.localeCompare(right.connection_id),
    ),
  }
}
