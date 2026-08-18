import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { createHookfishClientRoutes } from '../src/index.js'

describe('Hookfish client routes', () => {
  it('mount at an arbitrary Hono path', async () => {
    const hookfishFetch = vi.fn(async (request: Request) => {
      expect(new URL(request.url).pathname).toBe('/api/connections/providers')
      expect(request.headers.get('Authorization')).toMatch(
        /^Bearer hookfish_app_v1\./,
      )
      return Response.json({ providers: [{ id: 'github' }] })
    })
    const routes = createHookfishClientRoutes({
      auth: {
        authenticate: async () => ({
          authenticated: true,
          principal: { subject: 'user-1', tenantId: 'tenant-a' },
        }),
      },
      hookfishFetch,
      rootApiKey: 'root-secret',
    })
    const app = new Hono().route('/custom/connections', routes)

    const response = await app.request('/custom/connections/providers')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      providers: [{ id: 'github' }],
    })
    expect(hookfishFetch).toHaveBeenCalledOnce()
  })

  it('authenticates requests before calling the broker', async () => {
    const hookfishFetch = vi.fn(async () => Response.json({}))
    const routes = createHookfishClientRoutes({
      auth: {
        authenticate: async () => ({
          authenticated: false,
          response: Response.json({}, { status: 401 }),
        }),
      },
      hookfishFetch,
      rootApiKey: 'root-secret',
    })
    const app = new Hono().route('/hookfish', routes)

    expect(await app.request('/hookfish/providers')).toHaveProperty(
      'status',
      401,
    )
    expect(hookfishFetch).not.toHaveBeenCalled()
  })

  it('preserves encoded path structure for validation after mounting', async () => {
    const hookfishFetch = vi.fn(async () => Response.json({}))
    const routes = createHookfishClientRoutes({
      auth: {
        authenticate: async () => ({
          authenticated: true,
          principal: { subject: 'user-1', tenantId: 'tenant-a' },
        }),
      },
      hookfishFetch,
      rootApiKey: 'root-secret',
    })
    const app = new Hono().route('/custom/connections', routes)

    const response = await app.request(
      '/custom/connections/connections/team%2Fother/github',
    )

    expect(response.status).toBe(404)
    expect(hookfishFetch).not.toHaveBeenCalled()
  })
})
