import type { Database } from '../db/types.js'
import { BrokerError } from './errors.js'
import {
  MAX_RESOURCE_PATH_LENGTH,
  normalizeResourcePath,
} from './resource-path.js'

const TOKEN_PREFIX = 'hookfish_at_v1'
const APPLICATION_TOKEN_PREFIX = 'hookfish_app_v1'
const BROKER_TOKEN_VERSION = 2
const APPLICATION_TOKEN_VERSION = 2

export const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 60 * 60
export const MAX_ACCESS_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60

export type RootAccessGrant = {
  kind: 'root'
  scopes: ['**']
}

export type ScopedAccessGrant = {
  kind: 'scoped'
  name: string
  /** Persisted named grants have an ID; ephemeral application grants do not. */
  grantId?: string
  scopes: string[]
  expiresAt: number
  application?: {
    subject: string
    tenantId: string
  }
}

export type AccessGrant = RootAccessGrant | ScopedAccessGrant

type AccessTokenPayload = {
  v: typeof BROKER_TOKEN_VERSION
  gid: string
  iat: number
  exp: number
  jti: string
}

type ApplicationTokenPayload = {
  v: typeof APPLICATION_TOKEN_VERSION
  sub: string
  tenant: string
  scopes: string[]
  iat: number
  exp: number
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

// The return type is inferred rather than annotated: `CryptoKey` is only an
// ambient type under the DOM lib, and consumers may compile with a Node-only one.
async function importSigningKey(rootApiKey: string) {
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
 * Mint a short-lived capability used only between the authenticated client
 * facade and the raw API. It is stateless so Hookfish never has to persist a
 * reusable tenant credential, and its resource scope is enforced by the raw
 * API exactly like a named broker token.
 */
export async function mintApplicationAccessToken(
  rootApiKey: string,
  input: {
    subject: string
    tenantId: string
    scopes: string[]
    expiresIn?: number
  },
  now = Date.now(),
): Promise<string> {
  const expiresIn = input.expiresIn ?? 60
  if (!Number.isInteger(expiresIn) || expiresIn < 10 || expiresIn > 300) {
    throw new BrokerError(
      500,
      'invalid_application_token_ttl',
      'Application capabilities must live for 10 through 300 seconds.',
    )
  }
  const issuedAt = Math.floor(now / 1000)
  const payload: ApplicationTokenPayload = {
    v: APPLICATION_TOKEN_VERSION,
    sub: input.subject,
    tenant: input.tenantId,
    scopes: normalizeResourceScopes(input.scopes),
    iat: issuedAt,
    exp: issuedAt + expiresIn,
  }
  const encodedPayload = toBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  )
  const signingInput = `${APPLICATION_TOKEN_PREFIX}.${encodedPayload}`
  const signature = await crypto.subtle.sign(
    'HMAC',
    await importSigningKey(rootApiKey),
    new TextEncoder().encode(signingInput),
  )
  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`
}

async function verifyApplicationAccessToken(
  rootApiKey: string,
  token: string,
  now = Date.now(),
): Promise<ScopedAccessGrant> {
  try {
    const [prefix, encodedPayload, encodedSignature, extra] = token.split('.')
    if (
      prefix !== APPLICATION_TOKEN_PREFIX ||
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
    const subject = Reflect.get(parsed, 'sub')
    const tenant = Reflect.get(parsed, 'tenant')
    const scopes = Reflect.get(parsed, 'scopes')
    const issuedAt = Reflect.get(parsed, 'iat')
    const expiresAt = Reflect.get(parsed, 'exp')
    const nowSeconds = Math.floor(now / 1000)
    if (
      version !== APPLICATION_TOKEN_VERSION ||
      typeof subject !== 'string' ||
      !subject ||
      typeof tenant !== 'string' ||
      !tenant ||
      !Array.isArray(scopes) ||
      !scopes.every((scope) => typeof scope === 'string') ||
      !Number.isInteger(issuedAt) ||
      !Number.isInteger(expiresAt) ||
      issuedAt > nowSeconds + 30 ||
      expiresAt <= nowSeconds ||
      expiresAt - issuedAt > 300
    ) {
      throw invalidToken()
    }
    return {
      kind: 'scoped',
      name: `application.${toBase64Url(new TextEncoder().encode(tenant)).slice(0, 96)}`,
      scopes: normalizeResourceScopes(scopes),
      expiresAt,
      application: { subject, tenantId: tenant },
    }
  } catch (error) {
    if (error instanceof BrokerError && error.code === 'invalid_access_token') {
      throw error
    }
    throw invalidToken()
  }
}

/**
 * A scope is `**`, an exact resource path, or an explicit namespace ending in
 * `/**`. Exact and descendant access are intentionally distinct.
 */
export function normalizeResourceScope(scope: string): string {
  const normalized = scope.trim()

  if (
    normalized.length === 0 ||
    normalized.length > MAX_RESOURCE_PATH_LENGTH ||
    normalized.startsWith('/') ||
    normalized.endsWith('/') ||
    normalized.includes('//')
  ) {
    throw new BrokerError(
      400,
      'invalid_resource_scope',
      'Scope must be `**`, an exact resource path, or a namespace ending in `/**`.',
    )
  }

  if (normalized === '**') return normalized

  const isNamespace = normalized.endsWith('/**')
  const literal = isNamespace ? normalized.slice(0, -3) : normalized

  if (!literal || literal.includes('*')) {
    throw new BrokerError(
      400,
      'invalid_resource_scope',
      'Wildcards are only allowed as the final `/**` in a resource scope.',
    )
  }

  normalizeResourcePath(literal, 'resource')
  return isNamespace ? `${literal}/**` : literal
}

export function normalizeResourceScopes(scopes: string[]): string[] {
  const normalized = [...new Set(scopes.map(normalizeResourceScope))]

  if (normalized.length === 0 || normalized.length > 32) {
    throw new BrokerError(
      400,
      'invalid_resource_scopes',
      'Provide between 1 and 32 resource scopes.',
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

export function scopeAllowsResource(
  scope: string,
  resourcePath: string,
): boolean {
  if (scope === '**') return true

  const root = subtreeRoot(scope)
  if (root === undefined) return resourcePath === scope

  return resourcePath === root || resourcePath.startsWith(`${root}/`)
}

export function scopesAllowResource(
  scopes: string[],
  resourcePath: string,
): boolean {
  return scopes.some((scope) => scopeAllowsResource(scope, resourcePath))
}

export function scopeContainsScope(parent: string, child: string): boolean {
  if (parent === '**') return true
  if (parent === child) return true

  const parentRoot = subtreeRoot(parent)
  if (parentRoot === undefined) return false

  const childRoot = subtreeRoot(child)
  return scopeAllowsResource(parent, childRoot ?? child)
}

export function scopesContainScopes(
  parents: string[],
  children: string[],
): boolean {
  return children.every((child) =>
    parents.some((parent) => scopeContainsScope(parent, child)),
  )
}

export function assertConnectionAccess(grant: AccessGrant, path: string): void {
  assertResourceAccess(grant, path, 'connection')
}

function assertResourceAccess(
  grant: AccessGrant,
  path: string,
  resource: string,
): void {
  if (scopesAllowResource(grant.scopes, path)) return

  throw new BrokerError(
    403,
    'insufficient_scope',
    `This broker access token cannot access ${resource} "${path}".`,
  )
}

export function assertNamespaceAccess(
  grant: AccessGrant,
  namespace: string,
): void {
  const generatedDescendant = `${namespace}/__hookfish_generated__`
  if (scopesAllowResource(grant.scopes, generatedDescendant)) return

  throw new BrokerError(
    403,
    'insufficient_scope',
    `This broker access token cannot access resources below "${namespace}".`,
  )
}

export function assertCanDelegate(
  grant: AccessGrant,
  name: string,
  scopes: string[],
  expiresAt: number,
): string[] {
  const normalizedScopes = normalizeResourceScopes(scopes)

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
  grantId: string
  scopes: string[]
  expiresAt: number
}> {
  const name = normalizeTokenName(input.name)
  const scopes = normalizeResourceScopes(input.scopes)
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
  const grantId = crypto.randomUUID()
  const payload: AccessTokenPayload = {
    v: BROKER_TOKEN_VERSION,
    gid: grantId,
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
    grantId,
    scopes,
    expiresAt,
  }
}

export async function verifyAccessToken(
  rootApiKey: string,
  token: string,
  now = Date.now(),
): Promise<{
  tokenIdHash: string
  grantId: string
  expiresAt: number
}> {
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
    const issuedAt = Reflect.get(parsed, 'iat')
    const expiresAt = Reflect.get(parsed, 'exp')
    const tokenId = Reflect.get(parsed, 'jti')
    const grantId = Reflect.get(parsed, 'gid')
    const nowSeconds = Math.floor(now / 1000)
    if (
      version !== BROKER_TOKEN_VERSION ||
      typeof issuedAt !== 'number' ||
      typeof expiresAt !== 'number' ||
      typeof tokenId !== 'string' ||
      typeof grantId !== 'string' ||
      !grantId ||
      !Number.isInteger(issuedAt) ||
      !Number.isInteger(expiresAt) ||
      issuedAt > nowSeconds + 60 ||
      expiresAt <= nowSeconds
    ) {
      throw invalidToken()
    }

    return {
      grantId,
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
  if (token.startsWith(`${APPLICATION_TOKEN_PREFIX}.`)) {
    return verifyApplicationAccessToken(rootApiKey, token, now)
  }
  const verified = await verifyAccessToken(rootApiKey, token, now)
  const stored = await db.getValidBrokerAccessToken(
    verified.tokenIdHash,
    verified.grantId,
    new Date(now),
  )

  if (!stored) throw invalidToken()

  try {
    return {
      kind: 'scoped',
      name: stored.name,
      grantId: stored.grantId,
      scopes: normalizeResourceScopes(stored.grant.scopes),
      expiresAt: Math.min(
        verified.expiresAt,
        Math.floor(stored.grant.expiresAt.getTime() / 1000),
      ),
    }
  } catch {
    throw invalidToken()
  }
}
