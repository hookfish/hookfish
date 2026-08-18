import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { API_ORIGIN, createHarness, type TestHarness } from './harness'

describe('authenticated application facade', () => {
  let harness: TestHarness

  beforeEach(async () => {
    harness = await createHarness({
      auth: {
        authenticate: async (request) => {
          const tenantId = request.headers.get('X-Test-Tenant')
          return tenantId
            ? {
                authenticated: true,
                principal: { subject: 'test-user', tenantId },
              }
            : {
                authenticated: false,
                response: Response.json({}, { status: 401 }),
              }
        },
      },
    })
  })

  afterEach(async () => {
    await harness.close()
  })

  function client(
    path: string,
    tenantId?: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const headers = new Headers(init.headers)
    if (tenantId) headers.set('X-Test-Tenant', tenantId)
    if (init.method && init.method !== 'GET') headers.set('Origin', API_ORIGIN)
    if (init.body) headers.set('Content-Type', 'application/json')
    return harness.fetch(`/api/client${path}`, { ...init, headers })
  }

  it('requires auth and isolates connection operations by tenant', async () => {
    expect(await client('/connections')).toHaveProperty('status', 401)

    const stored = await client('/connections/team/secret/secret', 'tenant-a', {
      method: 'PUT',
      body: JSON.stringify({ secret: 'provider-secret' }),
    })
    expect(stored.status).toBe(200)
    await expect(stored.json()).resolves.toEqual({
      path: 'team/secret',
      stored: true,
    })

    const tenantA = await client('/connections', 'tenant-a')
    const tenantABody = await tenantA.json()
    expect(JSON.stringify(tenantABody)).not.toContain('provider-secret')
    expect(tenantABody).toMatchObject({
      connections: [{ path: 'team/secret', namespace: 'team' }],
    })

    const tenantB = await client('/connections', 'tenant-b')
    await expect(tenantB.json()).resolves.toEqual({ connections: [] })
    expect(await client('/connections/team/secret', 'tenant-b')).toHaveProperty(
      'status',
      404,
    )
    const tenantBDisconnect = await client(
      '/connections/team/secret',
      'tenant-b',
      { method: 'DELETE' },
    )
    expect(tenantBDisconnect.status).toBe(200)
    await expect(tenantBDisconnect.json()).resolves.toEqual({
      deleted: false,
      revocation: 'unsupported',
    })
    expect(await client('/connections/team/secret', 'tenant-a')).toHaveProperty(
      'status',
      200,
    )
  })

  it('completes OAuth without exposing the internal tenant namespace', async () => {
    const response = await client(
      '/connections/team/stub/authorize',
      'tenant-a',
      { method: 'POST', body: '{}' },
    )
    expect(response.status).toBe(200)
    const authorization = await response.json()
    expect(authorization).toMatchObject({
      path: 'team/stub',
      authorize_url: expect.stringContaining('state='),
      expires_at: expect.any(String),
    })
    expect(JSON.stringify(authorization)).not.toContain(
      '__hookfish_application',
    )

    const consent = await fetch(authorization.authorize_url, {
      redirect: 'manual',
    })
    const callbackUrl = consent.headers.get('location')
    if (!callbackUrl) throw new Error('Stub did not return a callback URL.')
    const callback = new URL(callbackUrl)
    const completed = await harness.fetch(
      `${callback.pathname}${callback.search}`,
    )
    expect(completed.status).toBe(200)
    const completionPage = await completed.text()
    expect(completionPage).toContain('team/stub')
    expect(completionPage).not.toContain('__hookfish_application')

    const tenantA = await client('/connections/team/stub', 'tenant-a')
    expect(tenantA.status).toBe(200)
    expect(await client('/connections/team/stub', 'tenant-b')).toHaveProperty(
      'status',
      404,
    )
  })

  it('never exposes secret retrieval or raw administrative operations', async () => {
    expect(
      await client('/connections/team/secret/secret/access', 'tenant-a', {
        method: 'POST',
      }),
    ).toHaveProperty('status', 404)
    expect(await client('/admin/tokens', 'tenant-a')).toHaveProperty(
      'status',
      404,
    )
  })
})
