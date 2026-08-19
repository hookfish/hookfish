import { createHookfishHooks } from '@hookfish/hooks'
import { backendUrl } from './api-url'

export const hookfish = createHookfishHooks({
  baseUrl: `${backendUrl}/api/client`,
})
