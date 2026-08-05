import { and, eq, gt } from 'drizzle-orm'
import type { Database } from '../db/schema'
import { brokerAccessTokens } from '../db/schema'
import { BrokerError } from './errors'

const TOKEN_PREFIX = 'hookfish_at_v1'
const TOKEN_VERSION = 1

export const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 60 * 60
export const MAX_ACCESS_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60

export type RootAccessGrant = {
  kind: 'root'
  scopes: ['**']
}

export type ScopedAccessGrant = {
  kind: 'scoped'
  name: string
  scopes: string[]
  expiresAt: number
}

export type AccessGrant = RootAccessGrant | ScopedAccessGrant

type AccessTokenPayload = {
  v: typeof TOKEN_VERSION
  name: string
  scopes: string[]
  iat: number
  exp: number
  jti: string
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url')

  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function randomId(): string {
  return toBase64Url(
    crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16))),
  )
}

async function importSigningKey(rootApiKey: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(rootApiKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

async function hashTokenId(tokenId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(tokenId),
  )
  return toBase64Url(new Uint8Array(digest))
}

function invalidToken(): BrokerError {
  return new BrokerError(
    401,
    'invalid_access_token',
    'The broker access token is invalid or expired.',
  )
}

/**
 * A scope is either `**` or a folder path. Folder paths are canonicalized to
 * end in `/**`. Connection ids are opaque; only `/` separates ancestors.
 */
export function normalizeConnectionScope(scope: string): string {
  const normalized = scope.trim()

  if (
    normalized.length === 0 ||
    normalized.length > 512 ||
    normalized.startsWith('/') ||
    normalized.endsWith('/') ||
    normalized.includes('//')
  ) {
    throw new BrokerError(
      400,
      'invalid_connection_scope',
      'Scope must be `**` or a folder path such as `team`.',
    )
  }

  if (normalized === '**') return normalized

  const literal = normalized.endsWith('/**')
    ? normalized.slice(0, -3)
    : normalized

  if (!literal || literal.includes('*')) {
    throw new BrokerError(
      400,
      'invalid_connection_scope',
      'Wildcards are only allowed as the final `/**` in a connection scope.',
    )
  }

  return `${literal}/**`
}

export function normalizeConnectionScopes(scopes: string[]): string[] {
  const normalized = [...new Set(scopes.map(normalizeConnectionScope))]

  if (normalized.length === 0 || normalized.length > 32) {
    throw new BrokerError(
      400,
      'invalid_connection_scopes',
      'Provide between 1 and 32 connection scopes.',
    )
  }

  if (normalized.includes('**')) return ['**']
  return normalized
}

export function normalizeTokenName(name: string): string {
  const normalized = name.trim()

  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(normalized)) {
    throw new BrokerError(
      400,
      'invalid_token_name',
      'Token name must be 1-128 characters using letters, numbers, dots, underscores, or hyphens.',
    )
  }

  return normalized
}

function subtreeRoot(scope: string): string | undefined {
  return scope.endsWith('/**') ? scope.slice(0, -3) : undefined
}

export function scopeAllowsConnection(
  scope: string,
  connectionId: string,
): boolean {
  if (scope === '**') return true

  const root = subtreeRoot(scope)
  if (root === undefined) return connectionId === scope

  return connectionId === root || connectionId.startsWith(`${root}/`)
}

export function scopesAllowConnection(
  scopes: string[],
  connectionId: string,
): boolean {
  return scopes.some((scope) => scopeAllowsConnection(scope, connectionId))
}

export function scopeContainsScope(parent: string, child: string): boolean {
  if (parent === '**') return true
  if (parent === child) return true

  const parentRoot = subtreeRoot(parent)
  if (parentRoot === undefined) return false

  const childRoot = subtreeRoot(child)
  return scopeAllowsConnection(parent, childRoot ?? child)
}

export function scopesContainScopes(
  parents: string[],
  children: string[],
): boolean {
  return children.every((child) =>
    parents.some((parent) => scopeContainsScope(parent, child)),
  )
}

export function assertConnectionAccess(
  grant: AccessGrant,
  connectionId: string,
): void {
  if (scopesAllowConnection(grant.scopes, connectionId)) return

  throw new BrokerError(
    403,
    'insufficient_scope',
    `This broker access token cannot access connection "${connectionId}".`,
  )
}

export function assertConnectionPrefixAccess(
  grant: AccessGrant,
  connectionIdPrefix: string,
): void {
  const generatedDescendant = `${connectionIdPrefix}/__hookfish_generated__`
  if (scopesAllowConnection(grant.scopes, generatedDescendant)) return

  throw new BrokerError(
    403,
    'insufficient_scope',
    `This broker access token cannot create connections below "${connectionIdPrefix}".`,
  )
}

export function assertCanDelegate(
  grant: AccessGrant,
  name: string,
  scopes: string[],
  expiresAt: number,
): string[] {
  const normalizedScopes = normalizeConnectionScopes(scopes)

  if (grant.kind === 'scoped' && !name.startsWith(`${grant.name}.`)) {
    throw new BrokerError(
      403,
      'insufficient_scope',
      `A broker access token named "${grant.name}" may mint only names in its "${grant.name}." namespace.`,
    )
  }

  if (!scopesContainScopes(grant.scopes, normalizedScopes)) {
    throw new BrokerError(
      403,
      'insufficient_scope',
      'A broker access token cannot mint scopes outside its own grant.',
    )
  }

  if (grant.kind === 'scoped' && expiresAt > grant.expiresAt) {
    throw new BrokerError(
      403,
      'insufficient_scope',
      'A delegated token cannot outlive the token that minted it.',
    )
  }

  return normalizedScopes
}

export function assertRootAccess(grant: AccessGrant): void {
  if (grant.scopes.includes('**')) return

  throw new BrokerError(
    403,
    'root_access_required',
    'This operation requires a root broker credential.',
  )
}

export async function mintAccessToken(
  rootApiKey: string,
  input: { name: string; scopes: string[]; expiresIn: number },
  now = Date.now(),
): Promise<{
  token: string
  tokenIdHash: string
  name: string
  scopes: string[]
  expiresAt: number
}> {
  const name = normalizeTokenName(input.name)
  const scopes = normalizeConnectionScopes(input.scopes)
  if (
    !Number.isInteger(input.expiresIn) ||
    input.expiresIn < 60 ||
    input.expiresIn > MAX_ACCESS_TOKEN_TTL_SECONDS
  ) {
    throw new BrokerError(
      400,
      'invalid_access_token_ttl',
      'Access token lifetime must be an integer from 60 seconds through 30 days.',
    )
  }

  const issuedAt = Math.floor(now / 1000)
  const expiresAt = issuedAt + input.expiresIn
  const tokenId = randomId()
  const payload: AccessTokenPayload = {
    v: TOKEN_VERSION,
    name,
    scopes,
    iat: issuedAt,
    exp: expiresAt,
    jti: tokenId,
  }
  const encodedPayload = toBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  )
  const signingInput = `${TOKEN_PREFIX}.${encodedPayload}`
  const [signature, tokenIdHash] = await Promise.all([
    crypto.subtle.sign(
      'HMAC',
      await importSigningKey(rootApiKey),
      new TextEncoder().encode(signingInput),
    ),
    hashTokenId(tokenId),
  ])

  return {
    token: `${signingInput}.${toBase64Url(new Uint8Array(signature))}`,
    tokenIdHash,
    name,
    scopes,
    expiresAt,
  }
}

export async function verifyAccessToken(
  rootApiKey: string,
  token: string,
  now = Date.now(),
): Promise<ScopedAccessGrant & { tokenIdHash: string }> {
  try {
    const [prefix, encodedPayload, encodedSignature, extra] = token.split('.')
    if (
      prefix !== TOKEN_PREFIX ||
      !encodedPayload ||
      !encodedSignature ||
      extra !== undefined
    ) {
      throw invalidToken()
    }

    const signingInput = `${prefix}.${encodedPayload}`
    const valid = await crypto.subtle.verify(
      'HMAC',
      await importSigningKey(rootApiKey),
      fromBase64Url(encodedSignature),
      new TextEncoder().encode(signingInput),
    )
    if (!valid) throw invalidToken()

    const parsed: unknown = JSON.parse(
      new TextDecoder().decode(fromBase64Url(encodedPayload)),
    )
    if (typeof parsed !== 'object' || parsed === null) throw invalidToken()

    const version = Reflect.get(parsed, 'v')
    const name = Reflect.get(parsed, 'name')
    const scopes = Reflect.get(parsed, 'scopes')
    const issuedAt = Reflect.get(parsed, 'iat')
    const expiresAt = Reflect.get(parsed, 'exp')
    const tokenId = Reflect.get(parsed, 'jti')
    const nowSeconds = Math.floor(now / 1000)
    if (
      version !== TOKEN_VERSION ||
      typeof name !== 'string' ||
      !Array.isArray(scopes) ||
      !scopes.every((scope) => typeof scope === 'string') ||
      typeof issuedAt !== 'number' ||
      typeof expiresAt !== 'number' ||
      typeof tokenId !== 'string' ||
      !Number.isInteger(issuedAt) ||
      !Number.isInteger(expiresAt) ||
      issuedAt > nowSeconds + 60 ||
      expiresAt <= nowSeconds
    ) {
      throw invalidToken()
    }

    return {
      kind: 'scoped',
      name: normalizeTokenName(name),
      scopes: normalizeConnectionScopes(scopes),
      expiresAt,
      tokenIdHash: await hashTokenId(tokenId),
    }
  } catch (error) {
    if (error instanceof BrokerError && error.code === 'invalid_access_token') {
      throw error
    }
    throw invalidToken()
  }
}

/**
 * A valid signature proves the token was minted by this broker. The persisted
 * record remains authoritative so revocation, scope narrowing, and shortened
 * expiration take effect on the next request.
 */
export async function authenticateAccessToken(
  db: Database,
  rootApiKey: string,
  token: string,
  now = Date.now(),
): Promise<ScopedAccessGrant> {
  const verified = await verifyAccessToken(rootApiKey, token, now)
  const [stored] = await db
    .select({
      name: brokerAccessTokens.name,
      scopes: brokerAccessTokens.scopes,
      expiresAt: brokerAccessTokens.expiresAt,
    })
    .from(brokerAccessTokens)
    .where(
      and(
        eq(brokerAccessTokens.name, verified.name),
        eq(brokerAccessTokens.tokenIdHash, verified.tokenIdHash),
        gt(brokerAccessTokens.expiresAt, new Date(now)),
      ),
    )
    .limit(1)

  if (!stored) throw invalidToken()

  try {
    return {
      kind: 'scoped',
      name: stored.name,
      scopes: normalizeConnectionScopes(stored.scopes),
      expiresAt: Math.min(
        verified.expiresAt,
        Math.floor(stored.expiresAt.getTime() / 1000),
      ),
    }
  } catch {
    throw invalidToken()
  }
}
