import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { credentials } from '../src/db/schema'
import {
  createHarness,
  OTHER_ENCRYPTION_KEY,
  TEST_ENCRYPTION_KEY,
  type TestHarness,
} from './harness'

type CredentialMetadata = {
  id: string
  name: string
  kind: 'headers' | 'opaque'
  fields: string[]
  last_used_at: string | null
}

describe('credential vault integration', () => {
  let h: TestHarness

  beforeAll(async () => {
    h = await createHarness()
  })

  afterAll(async () => {
    await h.close()
  })

  it('stores header values encrypted and only exposes metadata by default', async () => {
    const secret = 'Bearer header-secret-value'
    const create = await h.fetch('/api/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Production API',
        kind: 'headers',
        headers: {
          Authorization: secret,
          'X-API-Key': 'another-secret',
        },
      }),
    })

    expect(create.status).toBe(201)
    const createCopy = create.clone()
    const created: { credential: CredentialMetadata } = await create.json()
    expect(created.credential).toMatchObject({
      name: 'Production API',
      kind: 'headers',
      fields: ['authorization', 'x-api-key'],
      last_used_at: null,
    })
    expect(await createCopy.text()).not.toContain(secret)

    const [stored] = await h.db
      .select()
      .from(credentials)
      .where(eq(credentials.id, created.credential.id))
    expect(stored?.ownerId).toBe('test-owner')
    expect(stored?.encryptionVersion).toBe('v1')
    expect(JSON.stringify(stored)).not.toContain(secret)
    expect(stored?.encryptedPayload).not.toContain('another-secret')

    const get = await h.fetch(`/api/credentials/${created.credential.id}`)
    expect(get.status).toBe(200)
    expect(await get.text()).not.toContain(secret)

    const list = await h.fetch('/api/credentials?kind=headers')
    expect(list.status).toBe(200)
    const listed: { credentials: CredentialMetadata[] } = await list.json()
    expect(listed.credentials).toContainEqual(created.credential)

    const resolve = await h.fetch(
      `/api/credentials/${created.credential.id}/resolve`,
      { method: 'POST' },
    )
    expect(resolve.status).toBe(200)
    expect(resolve.headers.get('cache-control')).toBe('no-store')
    expect(resolve.headers.get('pragma')).toBe('no-cache')
    const resolved: {
      credential: CredentialMetadata
      payload: {
        kind: 'headers'
        headers: Record<string, string>
      }
    } = await resolve.json()
    expect(resolved.payload).toEqual({
      kind: 'headers',
      headers: {
        authorization: secret,
        'x-api-key': 'another-secret',
      },
    })
    expect(resolved.credential.last_used_at).not.toBeNull()
  })

  it('replaces a credential and rotates its encrypted payload', async () => {
    const create = await h.fetch('/api/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Old secret',
        kind: 'opaque',
        value: 'first-value',
      }),
    })
    const created: { credential: CredentialMetadata } = await create.json()
    const [before] = await h.db
      .select()
      .from(credentials)
      .where(eq(credentials.id, created.credential.id))

    const update = await h.fetch(`/api/credentials/${created.credential.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Rotated secret',
        kind: 'opaque',
        value: 'second-value',
      }),
    })
    expect(update.status).toBe(200)
    expect(await update.text()).not.toContain('second-value')

    const [after] = await h.db
      .select()
      .from(credentials)
      .where(eq(credentials.id, created.credential.id))
    expect(after?.encryptedPayload).not.toBe(before?.encryptedPayload)

    const resolve = await h.fetch(
      `/api/credentials/${created.credential.id}/resolve`,
      { method: 'POST' },
    )
    const resolved: { payload: { kind: 'opaque'; value: string } } =
      await resolve.json()
    expect(resolved.payload).toEqual({ kind: 'opaque', value: 'second-value' })
  })

  it('rejects headers that can alter HTTP routing or inject new headers', async () => {
    for (const [name, value] of [
      ['Host', 'attacker.example'],
      ['X-Forwarded-Host', 'attacker.example'],
      ['X-API-Key', 'value\r\nInjected: true'],
    ]) {
      const response = await h.fetch('/api/credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Unsafe',
          kind: 'headers',
          headers: { [name]: value },
        }),
      })
      expect(response.status).toBe(400)
    }
  })

  it('isolates every operation by owner', async () => {
    const create = await h.fetch('/api/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Owner A',
        kind: 'opaque',
        value: 'owner-a-secret',
      }),
    })
    const created: { credential: CredentialMetadata } = await create.json()

    h.env.CREDENTIALS_OWNER_ID = 'owner-b'
    try {
      const list = await h.fetch('/api/credentials')
      expect(await list.json()).toEqual({ credentials: [] })

      const get = await h.fetch(`/api/credentials/${created.credential.id}`)
      expect(get.status).toBe(404)

      const resolve = await h.fetch(
        `/api/credentials/${created.credential.id}/resolve`,
        { method: 'POST' },
      )
      expect(resolve.status).toBe(404)

      const remove = await h.fetch(
        `/api/credentials/${created.credential.id}`,
        { method: 'DELETE' },
      )
      expect(await remove.json()).toEqual({ deleted: false })
    } finally {
      h.env.CREDENTIALS_OWNER_ID = 'test-owner'
    }
  })

  it('requires a dedicated encryption key and detects key rotation', async () => {
    const previous = h.env.CREDENTIALS_ENCRYPTION_KEY
    h.env.CREDENTIALS_ENCRYPTION_KEY = undefined
    try {
      const missing = await h.fetch('/api/credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Missing key',
          kind: 'opaque',
          value: 'secret',
        }),
      })
      expect(missing.status).toBe(500)
      expect(await missing.json()).toMatchObject({
        error: { code: 'missing_configuration' },
      })
    } finally {
      h.env.CREDENTIALS_ENCRYPTION_KEY = previous
    }

    const create = await h.fetch('/api/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Rotation test',
        kind: 'opaque',
        value: 'rotation-secret',
      }),
    })
    const created: { credential: CredentialMetadata } = await create.json()

    h.env.CREDENTIALS_ENCRYPTION_KEY = OTHER_ENCRYPTION_KEY
    try {
      const resolve = await h.fetch(
        `/api/credentials/${created.credential.id}/resolve`,
        { method: 'POST' },
      )
      expect(resolve.status).toBe(500)
      expect(await resolve.json()).toMatchObject({
        error: { code: 'decryption_failed' },
      })
    } finally {
      h.env.CREDENTIALS_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY
    }
  })

  it('requires broker authentication and supports deletion', async () => {
    const unauthorized = await h.fetch('/api/credentials', {
      headers: { Authorization: 'Bearer wrong-key' },
    })
    expect(unauthorized.status).toBe(401)

    const create = await h.fetch('/api/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Disposable',
        kind: 'opaque',
        value: 'delete-me',
      }),
    })
    const created: { credential: CredentialMetadata } = await create.json()

    const remove = await h.fetch(`/api/credentials/${created.credential.id}`, {
      method: 'DELETE',
    })
    expect(await remove.json()).toEqual({ deleted: true })
    expect(
      (await h.fetch(`/api/credentials/${created.credential.id}`)).status,
    ).toBe(404)
  })
})
