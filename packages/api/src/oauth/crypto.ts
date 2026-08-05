import { BrokerError } from './errors'

/**
 * WebCrypto is available in supported Node versions.
 */

const IV_BYTES = 12

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * The explicit `ArrayBuffer` type argument matters: a plain `new Uint8Array(n)`
 * widens to `ArrayBufferLike`, which the DOM's `BufferSource` rejects when the
 * frontend typechecks these types through `AppType`.
 */
function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(length)))
}

export function randomToken(byteLength = 32): string {
  return toBase64Url(randomBytes(byteLength))
}

/** Hashes a short-lived bearer value before it is persisted. */
export async function hashToken(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return toBase64Url(new Uint8Array(digest))
}

async function importKey(encryptionKey: string): Promise<CryptoKey> {
  const raw = fromBase64(encryptionKey)

  if (raw.byteLength !== 32) {
    throw new BrokerError(
      500,
      'invalid_encryption_key',
      'OAUTH_ENCRYPTION_KEY must be 32 random bytes, base64-encoded. Generate one with: openssl rand -base64 32',
    )
  }

  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

/** Returns `base64(iv || ciphertext)`. */
export async function encryptSecret(
  encryptionKey: string,
  plaintext: string,
): Promise<string> {
  const key = await importKey(encryptionKey)
  const iv = randomBytes(IV_BYTES)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  )

  const payload = new Uint8Array(
    new ArrayBuffer(IV_BYTES + ciphertext.byteLength),
  )
  payload.set(iv, 0)
  payload.set(new Uint8Array(ciphertext), IV_BYTES)

  return toBase64(payload)
}

export async function decryptSecret(
  encryptionKey: string,
  encoded: string,
): Promise<string> {
  const key = await importKey(encryptionKey)
  const payload = fromBase64(encoded)
  const iv = payload.slice(0, IV_BYTES)
  const ciphertext = payload.slice(IV_BYTES)

  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext,
    )

    return new TextDecoder().decode(plaintext)
  } catch {
    throw new BrokerError(
      500,
      'decryption_failed',
      'Stored token could not be decrypted. OAUTH_ENCRYPTION_KEY has probably changed since it was written.',
    )
  }
}

export type PkcePair = {
  verifier: string
  challenge: string
}

export async function createPkcePair(): Promise<PkcePair> {
  const verifier = randomToken(32)
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  )

  return { verifier, challenge: toBase64Url(new Uint8Array(digest)) }
}

/** Length-independent comparison, to keep API-key checks off the timing side channel. */
export function safeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left)
  const b = new TextEncoder().encode(right)

  let mismatch = a.byteLength ^ b.byteLength

  for (let i = 0; i < Math.max(a.byteLength, b.byteLength); i += 1) {
    mismatch |= (a[i] ?? 0) ^ (b[i] ?? 0)
  }

  return mismatch === 0
}
