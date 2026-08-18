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

  it('keeps the raw API same-server by default and allows exact opt-in origins', async () => {
    const base = {
      db: {
        getDatabase() {
          throw new Error('Stats does not access the database.')
        },
      },
      providers: {},
    }
    const privateApi = await HookfishServer.init(base)
    const privateResponse = await privateApi.fetch(
      new Request('http://localhost/api/stats', {
        headers: { Origin: 'https://app.example' },
      }),
      {},
    )
    expect(privateResponse.status).toBe(200)
    expect(
      privateResponse.headers.get('Access-Control-Allow-Origin'),
    ).toBeNull()

    const optedIn = await HookfishServer.init({
      ...base,
      rawApiOrigins: ['https://operator.example'],
    })
    const allowed = await optedIn.fetch(
      new Request('http://localhost/api/stats', {
        headers: { Origin: 'https://operator.example' },
      }),
      {},
    )
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://operator.example',
    )
    const denied = await optedIn.fetch(
      new Request('http://localhost/api/stats', {
        headers: { Origin: 'https://evil.example' },
      }),
      {},
    )
    expect(denied.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('rejects wildcard origins and omits Swagger when disabled', async () => {
    const options = {
      db: {
        getDatabase() {
          throw new Error('Swagger does not access the database.')
        },
      },
      providers: {},
    }
    await expect(
      HookfishServer.init({ ...options, rawApiOrigins: ['*'] }),
    ).rejects.toThrow('does not allow')
    const server = await HookfishServer.init({
      ...options,
      includeSwagger: false,
    })
    expect(await server.request('/api/openapi.json')).toHaveProperty(
      'status',
      404,
    )
    expect(await server.request('/api/docs')).toHaveProperty('status', 404)
  })
})
