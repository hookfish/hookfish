import type { Database } from './db/types'
import {
  decryptSecret,
  encryptSecret,
  requireEncryptionKey,
} from './oauth/crypto'
import { BrokerError } from './oauth/errors'

export const MAX_SECRET_PATH_LENGTH = 768
const INTERNAL_PREFIX = '__hookfish/'

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

export function normalizeSecretPath(
  path: string,
  allowInternal = false,
): string {
  const normalized = path.trim().normalize('NFC')
  const segments = normalized.split('/')
  const invalid =
    normalized.length === 0 ||
    normalized.length > MAX_SECRET_PATH_LENGTH ||
    normalized.startsWith('/') ||
    normalized.endsWith('/') ||
    normalized.includes('\\') ||
    hasUnsafePathCharacters(normalized) ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === '.' ||
        segment === '..' ||
        decodesToPathStructure(segment),
    )

  if (invalid || (!allowInternal && normalized.startsWith(INTERNAL_PREFIX))) {
    throw new BrokerError(
      400,
      'invalid_secret_path',
      'Secret paths must be canonical slash-delimited identifiers without empty, dot, encoded structural, control, backslash, or reserved segments.',
    )
  }
  return normalized
}

export function providerClientSecretPath(providerId: string): string {
  return `${INTERNAL_PREFIX}providers/${providerId}/client-secret`
}

export async function putVaultSecret(
  db: Database,
  env: object,
  path: string,
  value: string,
  internal = false,
) {
  const normalized = normalizeSecretPath(path, internal)
  if (!value) {
    throw new BrokerError(
      400,
      'invalid_secret',
      'Secret value cannot be empty.',
    )
  }
  const encrypted = await encryptSecret(requireEncryptionKey(env), value)
  const stored = await db.putVaultSecret({
    path: normalized,
    value: encrypted,
  })
  return stored
}

export async function getVaultSecret(
  db: Database,
  env: object,
  path: string,
  internal = false,
): Promise<{ path: string; value: string }> {
  const normalized = normalizeSecretPath(path, internal)
  const stored = await db.getVaultSecret(normalized)
  if (!stored) {
    throw new BrokerError(
      404,
      'secret_not_found',
      `No secret at "${normalized}".`,
    )
  }
  return {
    path: stored.path,
    value: await decryptSecret(requireEncryptionKey(env), stored.value),
  }
}

export async function listVaultSecrets(
  db: Database,
  options: {
    prefix?: string
    scopes?: string[]
  } = {},
) {
  const prefix = options.prefix
    ? normalizeSecretPath(options.prefix)
    : undefined
  return db.listVaultSecrets({
    prefix,
    scopes: options.scopes,
    excludeInternalPrefix: INTERNAL_PREFIX,
  })
}

export async function deleteVaultSecret(
  db: Database,
  path: string,
  internal = false,
): Promise<boolean> {
  const normalized = normalizeSecretPath(path, internal)
  return db.deleteVaultSecret(normalized)
}
