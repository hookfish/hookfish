import { createHookfishHooks } from '@hookfish/hooks'
import { requestHookfish } from './hookfish.functions'
import { createHookfishServerFetch } from './hookfish-proxy'

export const hookfish = createHookfishHooks({
  baseUrl: '/api',
  fetch: createHookfishServerFetch(requestHookfish),
})
