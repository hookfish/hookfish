import { createServerFn } from '@tanstack/react-start'
import {
  type HookfishProxyRequest,
  validateHookfishProxyRequest,
} from './hookfish-proxy'
import { forwardHookfishProxyRequest } from './hookfish-proxy.server'

export const requestHookfish = createServerFn({ method: 'POST' })
  .validator(
    (input: unknown): HookfishProxyRequest =>
      validateHookfishProxyRequest(input),
  )
  .handler(async ({ data }): Promise<Response> => {
    return forwardHookfishProxyRequest(data)
  })
