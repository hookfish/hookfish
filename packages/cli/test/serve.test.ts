import { describe, expect, it } from 'vitest'
import { resolveBackendUrl } from '../src/serve'

describe('resolveBackendUrl', () => {
  it('prefers the explicit URL', () => {
    expect(
      resolveBackendUrl('https://api.example', {
        HOOKFISH_BACKEND_URL: 'http://127.0.0.1:8787',
      }),
    ).toBe('https://api.example')
  })

  it('accepts the environment URL', () => {
    expect(
      resolveBackendUrl(undefined, {
        HOOKFISH_BACKEND_URL: 'http://127.0.0.1:8787',
      }),
    ).toBe('http://127.0.0.1:8787')
  })

  it('rejects missing and non-http URLs', () => {
    expect(() => resolveBackendUrl(undefined, {})).toThrow(
      'HOOKFISH_BACKEND_URL',
    )
    expect(() => resolveBackendUrl('file:///tmp/hookfish', {})).toThrow(
      'http or https',
    )
  })
})
