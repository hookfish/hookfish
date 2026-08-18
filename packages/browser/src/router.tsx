import { type AnyRoute, createRouter } from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'
import {
  type HookfishBrowserRouterOptions,
  normalizeRouterBasepath,
  resolveHookfishBrowserConfig,
} from './config'
import { routeTree } from './routeTree.gen'

export type { HookfishBrowserRouterOptions } from './config'

export function createHookfishBrowserRouter<TRouteTree extends AnyRoute>(
  browserRouteTree: TRouteTree,
  options: HookfishBrowserRouterOptions = {},
) {
  return createRouter({
    routeTree: browserRouteTree,
    basepath: normalizeRouterBasepath(options.basepath),
    context: {
      hookfishBrowser: resolveHookfishBrowserConfig(options),
      queryClient: new QueryClient(),
    },
    scrollRestoration: true,
  })
}

export function getRouter(options: HookfishBrowserRouterOptions = {}) {
  return createHookfishBrowserRouter(routeTree, options)
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
