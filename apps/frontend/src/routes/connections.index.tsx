import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { OAuthConnections } from '@/components/oauth-connections'

export const Route = createFileRoute('/connections/')({
  component: ConnectionsIndex,
})

function ConnectionsIndex() {
  const navigate = useNavigate()

  function navigateToFolder(path: string) {
    if (path) {
      void navigate({ to: '/connections/$', params: { _splat: path } })
    } else {
      void navigate({ to: '/connections' })
    }
  }

  return (
    <main className="h-full min-h-0 overflow-hidden">
      <h1 className="sr-only">Connections</h1>
      <OAuthConnections currentPath="" onNavigate={navigateToFolder} />
    </main>
  )
}
