import { createHookfishHooks } from '@hookfish/hooks'
import { browserApiUrl } from './api-url'

export const hookfish = createHookfishHooks({
  baseUrl: browserApiUrl,
})
