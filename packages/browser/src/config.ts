import { useRouter } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import type { ComponentType } from 'react'

export type HookfishBrowserConfig = {
  /** Browser-safe Hono API exposed by the application host. */
  clientApiUrl: string
  /** Host-owned sign-in page shown after an authentication failure. */
  signInUrl: string
  /** Whether the router should render the outer HTML document for TanStack Start. */
  renderDocument: boolean
  /** Optional host-owned sign-in UI for the browser's `/sign-in` route. */
  SignInComponent?: ComponentType
}

export type HookfishBrowserRouterContext = {
  hookfishBrowser: HookfishBrowserConfig
  queryClient: QueryClient
}

export type HookfishBrowserRouterOptions = Partial<HookfishBrowserConfig> & {
  /** URL prefix at which the router is mounted. */
  basepath?: string
}

export const defaultHookfishBrowserConfig: HookfishBrowserConfig = {
  clientApiUrl: '/api/client',
  signInUrl: '/sign-in',
  renderDocument: true,
}

export function normalizeRouterBasepath(value = '/'): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed === '/') return '/'
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}`
}

export function resolveHookfishBrowserConfig(
  options: HookfishBrowserRouterOptions = {},
): HookfishBrowserConfig {
  const clientApiUrl =
    options.clientApiUrl?.trim().replace(/\/+$/, '') ||
    defaultHookfishBrowserConfig.clientApiUrl
  const signInUrl =
    options.signInUrl?.trim() || defaultHookfishBrowserConfig.signInUrl
  return {
    clientApiUrl,
    signInUrl,
    renderDocument:
      options.renderDocument ?? defaultHookfishBrowserConfig.renderDocument,
    ...(options.SignInComponent
      ? { SignInComponent: options.SignInComponent }
      : {}),
  }
}

export function useHookfishBrowserConfig(): HookfishBrowserConfig {
  const router = useRouter()
  return router.options.context.hookfishBrowser
}

export function useHookfishQueryClient(): QueryClient {
  const router = useRouter()
  const queryClient = router.options.context.queryClient
  if (!queryClient) {
    throw new Error('The Hookfish browser router has no query client.')
  }
  return queryClient
}
