import { HookfishClientError } from './errors.js'

export const MAX_RESOURCE_PATH_LENGTH = 768

// Keep these structural checks in sync with the broker implementation in
// packages/api/src/oauth/resource-path.ts. This copy throws HookfishClientError
// so @hookfish/client remains independent of @hookfish/api.
function hasUnsafePathCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint === undefined) continue

    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x200e ||
      codePoint === 0x200f ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    ) {
      return true
    }
  }

  return false
}

function decodesToPathStructure(segment: string): boolean {
  let decoded: string
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    return false
  }

  if (decoded === segment) return false
  return (
    decoded === '.' ||
    decoded === '..' ||
    decoded.includes('/') ||
    decoded.includes('\\') ||
    hasUnsafePathCharacters(decoded)
  )
}

export function normalizeResourcePath(path: string, resource: string): string {
  const segments = path.split('/')
  const structurallyInvalid =
    path.length === 0 ||
    path.length > MAX_RESOURCE_PATH_LENGTH ||
    path !== path.normalize('NFC') ||
    path.includes('\\') ||
    hasUnsafePathCharacters(path) ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === '.' ||
        segment === '..' ||
        decodesToPathStructure(segment),
    )

  if (structurallyInvalid) {
    throw new HookfishClientError(
      400,
      `invalid_${resource}_path`,
      `${resource[0]?.toUpperCase()}${resource.slice(1)} paths must be canonical slash-delimited identifiers without empty, dot, encoded structural, control, or backslash segments.`,
    )
  }

  return path
}
