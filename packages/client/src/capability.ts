import { HookfishClientError } from './errors.js'

const APPLICATION_TOKEN_PREFIX = 'hookfish_app_v1'
const TOKEN_VERSION = 1

type ApplicationTokenPayload = {
  v: typeof TOKEN_VERSION
  sub: string
  tenant: string
  scopes: string[]
  iat: number
  exp: number
}

export type ApplicationAccessGrant = {
  subject: string
  tenantId: string
  scopes: string[]
  expiresAt: number
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
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function importSigningKey(rootApiKey: string) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(rootApiKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

/** Mint the short-lived capability used between the client facade and broker. */
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
    throw new HookfishClientError(
      500,
      'invalid_application_token_ttl',
      'Application capabilities must live for 10 through 300 seconds.',
    )
  }
  const issuedAt = Math.floor(now / 1000)
  const payload: ApplicationTokenPayload = {
    v: TOKEN_VERSION,
    sub: input.subject,
    tenant: input.tenantId,
    scopes: input.scopes,
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

/** Verify an application capability before the broker applies its scopes. */
export async function verifyApplicationAccessToken(
  rootApiKey: string,
  token: string,
  now = Date.now(),
): Promise<ApplicationAccessGrant> {
  const [prefix, encodedPayload, encodedSignature, extra] = token.split('.')
  if (
    prefix !== APPLICATION_TOKEN_PREFIX ||
    !encodedPayload ||
    !encodedSignature ||
    extra !== undefined
  ) {
    throw new Error('Invalid application access token.')
  }

  const signingInput = `${prefix}.${encodedPayload}`
  const valid = await crypto.subtle.verify(
    'HMAC',
    await importSigningKey(rootApiKey),
    fromBase64Url(encodedSignature),
    new TextEncoder().encode(signingInput),
  )
  if (!valid) throw new Error('Invalid application access token.')

  const parsed: unknown = JSON.parse(
    new TextDecoder().decode(fromBase64Url(encodedPayload)),
  )
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid application access token.')
  }

  const version = Reflect.get(parsed, 'v')
  const subject = Reflect.get(parsed, 'sub')
  const tenantId = Reflect.get(parsed, 'tenant')
  const scopes = Reflect.get(parsed, 'scopes')
  const issuedAt = Reflect.get(parsed, 'iat')
  const expiresAt = Reflect.get(parsed, 'exp')
  const nowSeconds = Math.floor(now / 1000)
  if (
    version !== TOKEN_VERSION ||
    typeof subject !== 'string' ||
    !subject ||
    typeof tenantId !== 'string' ||
    !tenantId ||
    !Array.isArray(scopes) ||
    !scopes.every((scope) => typeof scope === 'string') ||
    !Number.isInteger(issuedAt) ||
    !Number.isInteger(expiresAt) ||
    issuedAt > nowSeconds + 30 ||
    expiresAt <= nowSeconds ||
    expiresAt - issuedAt > 300
  ) {
    throw new Error('Invalid application access token.')
  }

  return { subject, tenantId, scopes, expiresAt }
}

export function isApplicationAccessToken(token: string): boolean {
  return token.startsWith(`${APPLICATION_TOKEN_PREFIX}.`)
}
