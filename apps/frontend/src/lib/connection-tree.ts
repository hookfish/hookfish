import type { ConnectionsResponse } from '@hookfish/hooks'

export type Connection = ConnectionsResponse['connections'][number]

export type ConnectionFolder = {
  name: string
  path: string
  itemCount: number
}

export type ConnectionDirectory = {
  folders: ConnectionFolder[]
  connections: Connection[]
}

const CONNECTION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const CONNECTION_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function joinConnectionPath(path: string, name: string): string {
  return path ? `${path}/${name}` : name
}

export function connectionSlug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '')
}

export function validateConnectionSlug(slug: string): string | undefined {
  if (!slug) return 'Enter a connection ID.'
  if (!CONNECTION_SLUG_PATTERN.test(slug) || slug.length > 64) {
    return 'Use 1–64 lowercase letters, numbers, and single hyphens.'
  }
  return undefined
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
  resourcePaths: string[] = [],
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
      itemCount: 0,
    })
  }

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

  for (const resourcePath of resourcePaths) {
    if (currentPath && resourcePath === currentPath) continue
    if (!resourcePath.startsWith(prefix)) continue

    const remainder = resourcePath.slice(prefix.length)
    const separatorIndex = remainder.indexOf('/')
    if (separatorIndex === -1) continue

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
