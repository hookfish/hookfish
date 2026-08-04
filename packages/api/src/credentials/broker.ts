import { and, eq } from 'drizzle-orm'
import { type Credential, credentials, type Database } from '../db/schema'
import { readEnvString, requireEnvString } from '../oauth/config'
import { decryptSecret, encryptSecret } from '../oauth/crypto'
import { BrokerError } from '../oauth/errors'

const ENCRYPTION_VERSION = 'v1'
const DEFAULT_OWNER_ID = 'system'
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const BLOCKED_HEADERS = new Set([
  'connection',
  'content-length',
  'forwarded',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-proto',
])

function hasInvalidHeaderValueCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code <= 8 || (code >= 10 && code <= 31) || code === 127) return true
  }
  return false
}

export type CredentialInput =
  | { name: string; kind: 'headers'; headers: Record<string, string> }
  | { name: string; kind: 'opaque'; value: string }

export type CredentialPayload =
  | { kind: 'headers'; headers: Record<string, string> }
  | { kind: 'opaque'; value: string }

export type ResolvedCredential = {
  credential: Credential
  payload: CredentialPayload
}

function credentialOwnerId(env: object): string {
  return readEnvString(env, 'CREDENTIALS_OWNER_ID') ?? DEFAULT_OWNER_ID
}

function credentialsEncryptionKey(env: object): string {
  return requireEnvString(env, 'CREDENTIALS_ENCRYPTION_KEY')
}

function additionalData(credential: {
  id: string
  ownerId: string
  kind: string
  encryptionVersion: string
}): string {
  return JSON.stringify([
    'hookfish-credential',
    credential.encryptionVersion,
    credential.ownerId,
    credential.id,
    credential.kind,
  ])
}

function normalizeHeaders(
  input: Record<string, string>,
): Record<string, string> {
  const entries = Object.entries(input)
  if (entries.length === 0) {
    throw new BrokerError(
      400,
      'invalid_credential',
      'A header credential must contain at least one header.',
    )
  }

  const headers: Record<string, string> = {}
  for (const [inputName, value] of entries) {
    const name = inputName.toLowerCase()

    if (!HEADER_NAME.test(inputName)) {
      throw new BrokerError(
        400,
        'invalid_header',
        `Credential header name "${inputName}" is invalid.`,
      )
    }
    if (BLOCKED_HEADERS.has(name)) {
      throw new BrokerError(
        400,
        'unsafe_header',
        `Credential header "${inputName}" controls HTTP routing or framing and cannot be stored.`,
      )
    }
    if (name in headers) {
      throw new BrokerError(
        400,
        'duplicate_header',
        `Credential contains the header "${inputName}" more than once with different casing.`,
      )
    }
    if (hasInvalidHeaderValueCharacter(value)) {
      throw new BrokerError(
        400,
        'invalid_header',
        `Credential header "${inputName}" contains invalid control characters.`,
      )
    }

    headers[name] = value
  }

  return headers
}

function preparePayload(input: CredentialInput): {
  payload: CredentialPayload
  fields: string[]
} {
  if (input.kind === 'headers') {
    const headers = normalizeHeaders(input.headers)
    return {
      payload: { kind: 'headers', headers },
      fields: Object.keys(headers).sort(),
    }
  }

  return { payload: { kind: 'opaque', value: input.value }, fields: ['value'] }
}

async function encryptPayload(
  env: object,
  credential: {
    id: string
    ownerId: string
    kind: string
    encryptionVersion: string
  },
  payload: CredentialPayload,
): Promise<string> {
  return encryptSecret(credentialsEncryptionKey(env), JSON.stringify(payload), {
    additionalData: additionalData(credential),
    keyName: 'CREDENTIALS_ENCRYPTION_KEY',
    subject: 'Stored credential',
  })
}

function parsePayload(value: string, expectedKind: string): CredentialPayload {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new BrokerError(
      500,
      'invalid_stored_credential',
      'Stored credential payload is not valid JSON.',
    )
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new BrokerError(
      500,
      'invalid_stored_credential',
      'Stored credential payload has an invalid shape.',
    )
  }

  const kind = Reflect.get(parsed, 'kind')
  if (kind !== expectedKind) {
    throw new BrokerError(
      500,
      'invalid_stored_credential',
      'Stored credential kind does not match its authenticated record.',
    )
  }

  if (kind === 'opaque') {
    const value = Reflect.get(parsed, 'value')
    if (typeof value === 'string') return { kind, value }
  }

  if (kind === 'headers') {
    const headers = Reflect.get(parsed, 'headers')
    if (typeof headers === 'object' && headers !== null) {
      const values = Object.entries(headers)
      if (values.every(([, value]) => typeof value === 'string')) {
        const stringHeaders: Record<string, string> = {}
        for (const [name, value] of values) {
          if (typeof value === 'string') stringHeaders[name] = value
        }
        return { kind, headers: normalizeHeaders(stringHeaders) }
      }
    }
  }

  throw new BrokerError(
    500,
    'invalid_stored_credential',
    'Stored credential payload has an invalid shape.',
  )
}

async function ownedCredential(
  db: Database,
  env: object,
  id: string,
): Promise<Credential> {
  const ownerId = credentialOwnerId(env)
  const [credential] = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.id, id), eq(credentials.ownerId, ownerId)))
    .limit(1)

  if (!credential) {
    throw new BrokerError(404, 'credential_not_found', 'No such credential.')
  }

  return credential
}

export async function createCredential(
  db: Database,
  env: object,
  input: CredentialInput,
): Promise<Credential> {
  const id = crypto.randomUUID()
  const ownerId = credentialOwnerId(env)
  const prepared = preparePayload(input)
  const authenticatedRecord = {
    id,
    ownerId,
    kind: input.kind,
    encryptionVersion: ENCRYPTION_VERSION,
  }
  const encryptedPayload = await encryptPayload(
    env,
    authenticatedRecord,
    prepared.payload,
  )

  const [created] = await db
    .insert(credentials)
    .values({
      ...authenticatedRecord,
      name: input.name,
      fields: prepared.fields,
      encryptedPayload,
    })
    .returning()

  if (!created) {
    throw new BrokerError(
      500,
      'credential_write_failed',
      'Credential could not be stored.',
    )
  }
  return created
}

export async function listCredentials(
  db: Database,
  env: object,
  kind?: string,
): Promise<Credential[]> {
  const owner = eq(credentials.ownerId, credentialOwnerId(env))
  return kind
    ? db
        .select()
        .from(credentials)
        .where(and(owner, eq(credentials.kind, kind)))
    : db.select().from(credentials).where(owner)
}

export function getCredential(
  db: Database,
  env: object,
  id: string,
): Promise<Credential> {
  return ownedCredential(db, env, id)
}

export async function updateCredential(
  db: Database,
  env: object,
  id: string,
  input: CredentialInput,
): Promise<Credential> {
  const existing = await ownedCredential(db, env, id)
  const prepared = preparePayload(input)
  const authenticatedRecord = {
    id: existing.id,
    ownerId: existing.ownerId,
    kind: input.kind,
    encryptionVersion: ENCRYPTION_VERSION,
  }
  const encryptedPayload = await encryptPayload(
    env,
    authenticatedRecord,
    prepared.payload,
  )

  const [updated] = await db
    .update(credentials)
    .set({
      name: input.name,
      kind: input.kind,
      fields: prepared.fields,
      encryptionVersion: ENCRYPTION_VERSION,
      encryptedPayload,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(credentials.id, existing.id),
        eq(credentials.ownerId, existing.ownerId),
      ),
    )
    .returning()

  if (!updated) {
    throw new BrokerError(404, 'credential_not_found', 'No such credential.')
  }
  return updated
}

export async function resolveCredential(
  db: Database,
  env: object,
  id: string,
): Promise<ResolvedCredential> {
  const credential = await ownedCredential(db, env, id)
  const plaintext = await decryptSecret(
    credentialsEncryptionKey(env),
    credential.encryptedPayload,
    {
      additionalData: additionalData(credential),
      keyName: 'CREDENTIALS_ENCRYPTION_KEY',
      subject: 'Stored credential',
    },
  )
  const payload = parsePayload(plaintext, credential.kind)
  const usedAt = new Date()

  await db
    .update(credentials)
    .set({ lastUsedAt: usedAt })
    .where(
      and(
        eq(credentials.id, credential.id),
        eq(credentials.ownerId, credential.ownerId),
      ),
    )

  return { credential: { ...credential, lastUsedAt: usedAt }, payload }
}

export async function deleteCredential(
  db: Database,
  env: object,
  id: string,
): Promise<boolean> {
  const deleted = await db
    .delete(credentials)
    .where(
      and(
        eq(credentials.id, id),
        eq(credentials.ownerId, credentialOwnerId(env)),
      ),
    )
    .returning()

  return deleted.length > 0
}
