import { createHookfishHooks } from '@hookfish/hooks'
import { backendUrl } from './api-url'
import { MANAGEMENT_TOKEN_KEY } from './management-token'

export const hookfish = createHookfishHooks({
  baseUrl: `${backendUrl}/api`,
  headers: () => ({
    Authorization: `Bearer ${window.sessionStorage.getItem(MANAGEMENT_TOKEN_KEY) ?? ''}`,
  }),
})
