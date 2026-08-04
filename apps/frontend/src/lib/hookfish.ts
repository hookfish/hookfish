import { createHookfishHooks } from '@hookfish/hooks'
import { apiBaseUrl } from './api-url'

export const hookfish = createHookfishHooks({
  baseUrl: `${apiBaseUrl}/api`,
})
