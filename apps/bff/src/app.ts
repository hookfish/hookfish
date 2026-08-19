import type { ApplicationAuthProvider } from '@hookfish/client'
import {
  createHookfishClientRoutes,
  type HookfishFetch,
} from '@hookfish/client'
import { Hono } from 'hono'

export type HookfishBffOptions<Bindings extends object = object> = {
  applicationAuth: ApplicationAuthProvider<Bindings>
  authHandler(request: Request): Response | Promise<Response>
  clientOrigins?: readonly string[]
  hookfishFetch: HookfishFetch<Bindings>
  rootApiKey: string
}

/** Create the BFF without mounting any raw Hookfish routes. */
export function createHookfishBff<Bindings extends object = object>(
  options: HookfishBffOptions<Bindings>,
): Hono<{ Bindings: Bindings }> {
  const app = new Hono<{ Bindings: Bindings }>()

  app.on(['GET', 'POST'], '/api/auth/*', (context) =>
    options.authHandler(context.req.raw),
  )
  app.route(
    '/api/client',
    createHookfishClientRoutes({
      auth: options.applicationAuth,
      clientOrigins: options.clientOrigins,
      hookfishFetch: options.hookfishFetch,
      rootApiKey: options.rootApiKey,
      runtime: 'node-bff',
    }),
  )

  return app
}
