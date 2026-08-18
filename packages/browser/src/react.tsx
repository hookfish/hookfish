'use client'

import { RouterProvider } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { getRouter, type HookfishBrowserRouterOptions } from './router'

export type HookfishBrowserProps = Omit<
  HookfishBrowserRouterOptions,
  'renderDocument'
>

/** Mount the Hookfish router inside a host such as a Next.js catch-all route. */
export function HookfishBrowser(props: HookfishBrowserProps) {
  const [mounted, setMounted] = useState(false)
  const router = useRef<ReturnType<typeof getRouter>>(undefined)
  useEffect(() => setMounted(true), [])

  // Next.js client components are still pre-rendered. Wait for the browser so
  // TanStack Router initializes from the actual catch-all URL.
  if (!mounted) return null

  router.current ??= getRouter({ ...props, renderDocument: false })
  return <RouterProvider router={router.current} />
}
