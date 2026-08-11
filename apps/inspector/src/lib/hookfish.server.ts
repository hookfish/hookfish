import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Hookfish } from '@hookfish/api'
import { pglite } from '@hookfish/database/pglite'
import '@tanstack/react-start/server-only'
import config from '../../../../hookfish.config'

const inspectorDataDir =
  process.env.PGLITE_DATA_DIR ?? path.resolve(process.cwd(), 'pgdata')

function localEncryptionKey() {
  const configured = process.env.OAUTH_ENCRYPTION_KEY?.trim()
  if (configured) return configured

  const keyPath = path.join(inspectorDataDir, '.hookfish-oauth-key')
  try {
    const stored = readFileSync(keyPath, 'utf8').trim()
    if (stored) return stored
  } catch {
    // The first local run creates a key below.
  }

  mkdirSync(inspectorDataDir, { recursive: true })
  const generated = randomBytes(32).toString('base64')
  try {
    writeFileSync(keyPath, `${generated}\n`, { flag: 'wx', mode: 0o600 })
    return generated
  } catch {
    // Another request or process may have created it concurrently.
    const stored = readFileSync(keyPath, 'utf8').trim()
    if (stored) return stored
    throw new Error('The inspector OAuth encryption key is empty.')
  }
}

const encryptionKey = localEncryptionKey()

function inspectorEnvironment(origin: string) {
  const apiKey = process.env.HOOKFISH_API_KEY || 'test'

  return {
    ...process.env,
    BROKER_API_KEY: apiKey,
    HOOKFISH_API_KEY: apiKey,
    OAUTH_ENCRYPTION_KEY: encryptionKey,
    OAUTH_REDIRECT_BASE_URL: origin,
  }
}

type InspectorEnvironment = ReturnType<typeof inspectorEnvironment>

const db = pglite<InspectorEnvironment>(inspectorDataDir)

const hookfishByOrigin = new Map<
  string,
  Promise<Hookfish<InspectorEnvironment>>
>()

function hookfishForOrigin(origin: string) {
  const existing = hookfishByOrigin.get(origin)
  if (existing) return existing

  const hookfish = Hookfish.init<InspectorEnvironment>(
    {
      ...config,
      db,
      includeClient: true,
      returnTo: origin,
      trustedOrigins: [origin],
    },
    {
      runtime: 'tanstack-start',
      browserOrigins: [origin],
      brokerApiKey: (environment) => environment?.HOOKFISH_API_KEY || 'test',
    },
  )
  hookfishByOrigin.set(origin, hookfish)
  return hookfish
}

export async function handleHookfishRequest(request: Request) {
  const origin = new URL(request.url).origin
  const hookfish = await hookfishForOrigin(origin)

  return hookfish.fetch(request, inspectorEnvironment(origin))
}
