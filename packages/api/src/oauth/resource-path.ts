import { BrokerError } from './errors'

export const MAX_RESOURCE_PATH_LENGTH = 512

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
    // A literal percent sign is safe when the value is subsequently encoded as
    // a URL component. Only decoded structural values are ambiguous.
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

/** Validate a URL-shaped resource identifier shared by connections and providers. */
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
    throw new BrokerError(
      400,
      `invalid_${resource}_path`,
      `${resource[0]?.toUpperCase()}${resource.slice(1)} paths must be canonical slash-delimited identifiers without empty, dot, encoded structural, control, or backslash segments.`,
    )
  }

  return path
}

export function assertOrganizationResourcePath(
  organization: string | undefined,
  path: string,
  resource: string,
): void {
  normalizeResourcePath(path, resource)
  if (!organization) return

  if (path === organization || path.startsWith(`${organization}/`)) return

  throw new BrokerError(
    403,
    'organization_mismatch',
    `${resource[0]?.toUpperCase()}${resource.slice(1)} "${path}" is outside organization "${organization}".`,
  )
}

export function encodeResourcePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}
