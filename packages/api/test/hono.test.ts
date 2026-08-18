import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { HookfishServer } from '../src'

describe('HookfishServer Hono application', () => {
  it('mounts in a parent Hono application without claiming other routes', async () => {
    const hookfish = await HookfishServer.init({
      db: {
        getDatabase() {
          throw new Error('OpenAPI does not access the database.')
        },
      },
      providers: {},
    })
    const app = new Hono()
      .route('/', hookfish)
      .get('/application', (context) => context.json({ application: true }))

    const hookfishResponse = await app.request('/api/openapi.json')
    expect(hookfishResponse.status).toBe(200)
    await expect(hookfishResponse.json()).resolves.toMatchObject({
      info: { title: 'Hookfish API' },
    })

    const applicationResponse = await app.request('/application')
    await expect(applicationResponse.json()).resolves.toEqual({
      application: true,
    })
  })

  it('remains a standalone Fetch handler', async () => {
    const hookfish = await HookfishServer.init({
      db: {
        getDatabase() {
          throw new Error('OpenAPI does not access the database.')
        },
      },
      providers: {},
    })

    const response = await hookfish.fetch(
      new Request('http://localhost/api/openapi.json'),
      {},
    )
    expect(response.status).toBe(200)
  })
})
