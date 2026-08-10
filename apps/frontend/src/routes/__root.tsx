import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Link, Outlet, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { BrokerAccess } from '@/components/credential-management'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { apiDocsUrl } from '@/lib/api-url'
import { useManagementToken } from '@/lib/management-token'
import '../index.css'

const queryClient = new QueryClient()

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>
  )
}

function AppShell() {
  const { token, setToken } = useManagementToken()

  return (
    <TooltipProvider>
      <a
        href="#main-content"
        className="fixed top-2 left-2 z-50 -translate-y-20 bg-primary px-4 py-3 text-sm font-medium text-primary-foreground focus:translate-y-0"
      >
        Skip to content
      </a>
      <div className="min-h-svh bg-background">
        <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur-sm motion-reduce:backdrop-blur-none">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 md:px-8">
            <div className="flex shrink-0 items-baseline gap-4">
              <strong className="text-sm font-medium tracking-widest uppercase">
                Hookfish
              </strong>
              <span className="hidden text-xs tracking-wide text-foreground/40 uppercase sm:inline">
                Credential broker
              </span>
            </div>
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
              <Button
                variant="ghost"
                size="sm"
                className="hidden md:inline-flex"
                asChild
              >
                <a href={apiDocsUrl}>API Docs</a>
              </Button>
              <BrokerAccess token={token} onTokenChange={setToken} />
            </nav>
          </div>
        </header>
        <div
          id="main-content"
          className="h-[calc(100svh-4rem)] w-full scroll-mt-16 overflow-hidden"
        >
          <Outlet />
        </div>
      </div>
      <TanStackRouterDevtools />
    </TooltipProvider>
  )
}
