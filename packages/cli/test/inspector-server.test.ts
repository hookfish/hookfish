import { describe, expect, it } from 'vitest'
import { inspectorServerConfig } from '../src/inspector-server'

describe('inspectorServerConfig', () => {
  it('serves directly at localhost on port 3000 by default', () => {
    expect(inspectorServerConfig({})).toEqual({
      host: '127.0.0.1',
      port: 3000,
      origin: 'http://localhost:3000',
    })
  })

  it('uses the third Conductor port', () => {
    expect(inspectorServerConfig({ CONDUCTOR_PORT: '4100' })).toEqual({
      host: '127.0.0.1',
      port: 4102,
      origin: 'http://localhost:4102',
    })
  })

  it('supports explicit bind and public URL overrides', () => {
    expect(
      inspectorServerConfig({
        INSPECTOR_HOST: '::1',
        INSPECTOR_PORT: '4242',
        HOOKFISH_INSPECTOR_URL: 'https://inspector.example.com',
      }),
    ).toEqual({
      host: '::1',
      port: 4242,
      origin: 'https://inspector.example.com',
    })
  })
})
