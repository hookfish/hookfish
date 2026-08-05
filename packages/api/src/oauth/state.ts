import { decryptSecret, encryptSecret, randomToken } from './crypto'
import { BrokerError } from './errors'
import { ORGANIZATION_PATTERN } from './organization'

const ROUTED_STATE_PREFIX = 'hookfish_state_v1'

function requireStateEncryptionKey(env: object): string {
  const value = Reflect.get(env, 'OAUTH_ENCRYPTION_KEY')
  if (typeof value === 'string' && value.trim()) return value.trim()

  throw new BrokerError(
    500,
    'missing_configuration',
    'OAUTH_ENCRYPTION_KEY is required for organization-scoped OAuth state routing.',
  )
}

/**
 * Keeps global authorization state compact while embedding an authenticated,
 * confidential storage-partition key for organization-scoped callbacks.
 */
export async function createAuthorizationState(
  env: object,
  organization: string | undefined,
): Promise<string> {
  const nonce = randomToken(32)
  if (!organization) return nonce

  const payload = await encryptSecret(
    requireStateEncryptionKey(env),
    JSON.stringify({ organization, nonce }),
  )
  return `${ROUTED_STATE_PREFIX}.${payload}`
}

/** Resolve the database partition before the callback reads persisted state. */
export async function organizationFromAuthorizationState(
  env: object,
  state: string | undefined,
): Promise<string | undefined> {
  if (!state?.startsWith(`${ROUTED_STATE_PREFIX}.`)) return undefined

  try {
    const encoded = state.slice(ROUTED_STATE_PREFIX.length + 1)
    const decoded: unknown = JSON.parse(
      await decryptSecret(requireStateEncryptionKey(env), encoded),
    )
    if (typeof decoded !== 'object' || decoded === null) throw new Error()

    const organization = Reflect.get(decoded, 'organization')
    const nonce = Reflect.get(decoded, 'nonce')
    if (
      typeof organization !== 'string' ||
      !ORGANIZATION_PATTERN.test(organization) ||
      typeof nonce !== 'string' ||
      nonce.length < 32
    ) {
      throw new Error()
    }

    return organization
  } catch (error) {
    if (
      error instanceof BrokerError &&
      error.code === 'missing_configuration'
    ) {
      throw error
    }
    throw new BrokerError(
      400,
      'invalid_state',
      'Authorization state is invalid.',
    )
  }
}
