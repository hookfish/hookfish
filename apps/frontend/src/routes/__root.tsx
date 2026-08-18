import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import appCss from '../index.css?url'

const queryClient = new QueryClient()

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      { title: 'Hookfish' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: RootLayout,
  shellComponent: RootDocument,
})

function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>
  )
}

function AppShell() {
  return (
    <TooltipProvider>
      <a
        href="#main-content"
        className="fixed top-2 left-2 z-50 -translate-y-20 bg-primary px-4 py-3 text-sm font-medium text-primary-foreground focus:translate-y-0"
      >
        Skip to content
      </a>
      <div className="h-svh overflow-hidden bg-background">
        <header className="sticky top-0 z-10 h-16 border-b bg-background/95 backdrop-blur-sm motion-reduce:backdrop-blur-none">
          <div className="mx-auto flex h-full max-w-6xl items-center justify-between gap-4 px-4 md:px-8">
            <strong className="text-sm font-medium tracking-widest uppercase">
              Hookfish
            </strong>
            <nav
              aria-label="Primary navigation"
              className="flex items-center gap-1"
            >
              <Button variant="ghost" size="sm" asChild>
                <Link
                  to="/connections"
                  activeProps={{ 'aria-current': 'page' }}
                >
                  Connections
                </Link>
              </Button>
            </nav>
          </div>
        </header>
        <div
          id="main-content"
          className="h-[calc(100svh-4rem)] min-h-0 w-full scroll-mt-16 overflow-hidden"
        >
          <Outlet />
        </div>
      </div>
      <TanStackRouterDevtools />
    </TooltipProvider>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
