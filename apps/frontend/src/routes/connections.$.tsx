import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { BrokerAccessPrompt } from '@/components/credential-management'
import { OAuthConnections } from '@/components/oauth-connections'
import { useManagementToken } from '@/lib/management-token'

export const Route = createFileRoute('/connections/$')({
  component: FolderConnections,
})

function FolderConnections() {
  const { _splat: currentPath } = Route.useParams()
  const { token, setToken } = useManagementToken()
  const navigate = useNavigate()

  if (!token) {
    return (
      <main className="h-full min-h-0 overflow-hidden">
        <BrokerAccessPrompt onTokenChange={setToken} />
      </main>
    )
  }

  function navigateToFolder(path: string) {
    if (path) {
      void navigate({ to: '/connections/$', params: { _splat: path } })
    } else {
      void navigate({ to: '/connections' })
    }
  }

  return (
    <main className="h-full min-h-0 overflow-hidden">
      <h1 className="sr-only">Connections in {currentPath}</h1>
      <OAuthConnections
        managementToken={token}
        currentPath={currentPath ?? ''}
        onNavigate={navigateToFolder}
      />
    </main>
  )
}
