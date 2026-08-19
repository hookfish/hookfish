import { describe, expect, it } from 'vitest'
import { getRouter, type HookfishBrowserRouterOptions } from './router'

describe('getRouter', () => {
  it('configures an embeddable router without rendering a document', () => {
    const options: HookfishBrowserRouterOptions = {
      basepath: '/settings/integrations/',
      clientApiUrl: '/api/hookfish/',
      signInUrl: '/login',
      renderDocument: false,
    }
    const router = getRouter(options)

    expect(router.basepath).toBe('/settings/integrations')
    expect(router.options.context?.hookfishBrowser).toEqual({
      clientApiUrl: '/api/hookfish',
      signInUrl: '/login',
      renderDocument: false,
    })
    expect(router.options.context?.queryClient).toBeDefined()
  })
})
