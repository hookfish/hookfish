import {
  joinConnectionPath,
  validateConnectionName,
  validateConnectionPath,
} from './connection-tree'

export const LOCAL_FOLDERS_KEY = 'hookfish.connection-folders.v1'

export function normalizeLocalFolders(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value.filter(
        (folder): folder is string =>
          typeof folder === 'string' &&
          folder.length > 0 &&
          validateConnectionPath(folder) === undefined,
      ),
    ),
  ].sort((left, right) => left.localeCompare(right))
}

export function readLocalFolders(storage: Pick<Storage, 'getItem'>): string[] {
  const stored = storage.getItem(LOCAL_FOLDERS_KEY)
  if (!stored) return []
  try {
    return normalizeLocalFolders(JSON.parse(stored))
  } catch {
    return []
  }
}

export function addLocalFolder(
  folders: string[],
  currentPath: string,
  name: string,
): string[] {
  const normalizedName = name.trim()
  const error = validateConnectionName(normalizedName)
  if (error) throw new Error(error)
  return normalizeLocalFolders([
    ...folders,
    joinConnectionPath(currentPath, normalizedName),
  ])
}
