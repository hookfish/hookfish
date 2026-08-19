import { describe, expect, it, vi } from 'vitest'
import { createHookfishBff } from '../src/app.ts'

function authenticatedBff(
  hookfishFetch = vi.fn(async () => Response.json({})),
) {
  return {
    app: createHookfishBff({
      applicationAuth: {
        authenticate: async () => ({
          authenticated: true as const,
          principal: { subject: 'user-1', tenantId: 'tenant-a' },
        }),
      },
      authHandler: () => Response.json({ session: null }),
      hookfishFetch,
      rootApiKey: 'root-secret',
    }),
    hookfishFetch,
  }
}

describe('Hookfish BFF', () => {
  it('mounts Better Auth', async () => {
    const { app } = authenticatedBff()

    const response = await app.request('/api/auth/get-session')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ session: null })
  })

  it('mounts the authenticated client routes', async () => {
    const hookfishFetch = vi.fn(async (request: Request) => {
      expect(new URL(request.url).pathname).toBe('/api/connections/providers')
      return Response.json({ providers: [] })
    })
    const { app } = authenticatedBff(hookfishFetch)

    const response = await app.request('/api/client/providers')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ providers: [] })
    expect(hookfishFetch).toHaveBeenCalledOnce()
  })

  it('does not mount the raw Hookfish API', async () => {
    const { app, hookfishFetch } = authenticatedBff()

    const response = await app.request('/api/admin/tokens')

    expect(response.status).toBe(404)
    expect(hookfishFetch).not.toHaveBeenCalled()
  })
})
