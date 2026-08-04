import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { OAuthConnections } from '@/components/oauth-connections'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { hookfish } from '../lib/hookfish'
import { getHealth } from '../lib/server-functions'

export const Route = createFileRoute('/')({
  component: Dashboard,
})

function Dashboard() {
  const healthQuery = useQuery({
    queryKey: ['server-function', 'health'],
    queryFn: () => getHealth(),
  })

  const statsQuery = hookfish.useStats()

  return (
    <main className="grid gap-6">
      <section className="grid max-w-3xl gap-3">
        <Badge variant="secondary" className="w-fit">
          Hookfish dashboard
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Connect accounts without exposing broker credentials.
        </h1>
        <p className="text-muted-foreground">
          Manage OAuth providers and connections through typed Hono RPC hooks.
          TanStack Start keeps the broker API key on the server.
        </p>
      </section>

      <OAuthConnections />

      <section className="grid gap-2">
        <h2 className="text-lg font-medium">Runtime</h2>
        <p className="text-sm text-muted-foreground">
          Deployment health and metadata for this Hookfish instance.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Health</CardTitle>
            <CardDescription>Current server function response</CardDescription>
          </CardHeader>
          <CardContent>
            {healthQuery.isPending ? (
              <div className="grid gap-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-56" />
              </div>
            ) : null}
            {healthQuery.isError ? (
              <Alert variant="destructive">
                <AlertTitle>Health check failed</AlertTitle>
                <AlertDescription>{healthQuery.error.message}</AlertDescription>
              </Alert>
            ) : null}
            {healthQuery.data ? (
              <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Status</dt>
                <dd className="font-medium">
                  {healthQuery.data.ok ? 'OK' : 'Down'}
                </dd>
                <dt className="text-muted-foreground">Runtime</dt>
                <dd className="font-medium">{healthQuery.data.runtime}</dd>
                <dt className="text-muted-foreground">Checked</dt>
                <dd className="font-medium">
                  {new Date(healthQuery.data.checkedAt).toLocaleString()}
                </dd>
              </dl>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Hono Stats</CardTitle>
            <CardDescription>
              Runtime metadata from the mounted Hono API
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {statsQuery.isPending ? (
              <div className="grid gap-3">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-36" />
              </div>
            ) : null}
            {statsQuery.isError ? (
              <Alert variant="destructive">
                <AlertTitle>Stats request failed</AlertTitle>
                <AlertDescription>{statsQuery.error.message}</AlertDescription>
              </Alert>
            ) : null}
            {statsQuery.data ? (
              <>
                <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">Region</dt>
                  <dd className="font-medium">{statsQuery.data.region}</dd>
                  <dt className="text-muted-foreground">Mode</dt>
                  <dd className="font-medium">{statsQuery.data.uptimeMode}</dd>
                </dl>
                <ul className="flex flex-wrap gap-2">
                  {statsQuery.data.features.map((feature) => (
                    <li key={feature}>
                      <Badge variant="outline">{feature}</Badge>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
