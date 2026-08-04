import type { ConnectionsResponse, ProvidersResponse } from '@hookfish/hooks'
import { Link2Icon, PlugZapIcon, ShieldCheckIcon } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { hookfish } from '@/lib/hookfish'

type Provider = ProvidersResponse['providers'][number]
type Connection = ConnectionsResponse['connections'][number]

function ProviderItem({
  provider,
  connectionCount,
  connecting,
  onConnect,
}: {
  provider: Provider
  connectionCount: number
  connecting: boolean
  onConnect: () => void
}) {
  return (
    <Item variant="outline">
      <ItemMedia variant="icon">
        <PlugZapIcon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          {provider.label}
          <Badge variant={provider.configured ? 'secondary' : 'outline'}>
            {provider.configured ? 'Ready' : 'Needs credentials'}
          </Badge>
        </ItemTitle>
        <ItemDescription>
          {connectionCount === 0
            ? `${provider.scopes.length} default scopes`
            : `${connectionCount} connection${connectionCount === 1 ? '' : 's'}`}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button
          size="sm"
          variant={connectionCount > 0 ? 'outline' : 'default'}
          disabled={!provider.configured || connecting}
          onClick={onConnect}
        >
          {connecting ? <Spinner /> : null}
          {connecting
            ? 'Opening'
            : connectionCount > 0
              ? 'Connect another'
              : 'Connect'}
        </Button>
      </ItemActions>
    </Item>
  )
}

function ConnectionItem({
  connection,
  disconnecting,
  onDisconnect,
}: {
  connection: Connection
  disconnecting: boolean
  onDisconnect: () => void
}) {
  const label =
    connection.external_account_label ??
    connection.external_account_id ??
    connection.connection_id

  return (
    <Item variant="outline">
      <ItemMedia variant="icon">
        <Link2Icon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          {label}
          <Badge variant="outline">{connection.provider}</Badge>
        </ItemTitle>
        <ItemDescription>
          ID: {connection.connection_id}
          {connection.scopes.length > 0
            ? ` · ${connection.scopes.length} scopes`
            : ''}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="destructive" disabled={disconnecting}>
              {disconnecting ? <Spinner /> : null}
              {disconnecting ? 'Disconnecting' : 'Disconnect'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogMedia>
                <ShieldCheckIcon />
              </AlertDialogMedia>
              <AlertDialogTitle>Disconnect {label}?</AlertDialogTitle>
              <AlertDialogDescription>
                Hookfish will revoke the provider credential when supported and
                remove the stored connection.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={onDisconnect}>
                Disconnect
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </ItemActions>
    </Item>
  )
}

function LoadingItems() {
  return (
    <div className="grid gap-3">
      {[0, 1, 2].map((index) => (
        <div
          className="flex items-center gap-3 rounded-lg border p-3"
          key={index}
        >
          <Skeleton className="size-8 rounded-lg" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="h-7 w-20" />
        </div>
      ))}
    </div>
  )
}

export function OAuthConnections() {
  const providersQuery = hookfish.useProviders()
  const connectionsQuery = hookfish.useConnections()
  const authorizeMutation = hookfish.useAuthorizeConnection({
    onSuccess(data) {
      window.location.assign(data.authorize_url)
    },
  })
  const disconnectMutation = hookfish.useDisconnectConnection()

  const queryError = providersQuery.error ?? connectionsQuery.error
  const mutationError = authorizeMutation.error ?? disconnectMutation.error

  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>OAuth Providers</CardTitle>
          <CardDescription>
            Start a typed authorization flow without exposing the broker key.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {providersQuery.isPending ? <LoadingItems /> : null}
          {providersQuery.data ? (
            <ItemGroup>
              {providersQuery.data.providers.map((provider) => {
                const connectionCount =
                  connectionsQuery.data?.connections.filter(
                    (connection) => connection.provider === provider.id,
                  ).length ?? 0

                return (
                  <ProviderItem
                    key={provider.id}
                    provider={provider}
                    connectionCount={connectionCount}
                    connecting={
                      authorizeMutation.isPending &&
                      authorizeMutation.variables?.provider === provider.id
                    }
                    onConnect={() =>
                      authorizeMutation.mutate({ provider: provider.id })
                    }
                  />
                )
              })}
            </ItemGroup>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Connections</CardTitle>
          <CardDescription>
            Browser-safe account metadata returned through the shared hooks.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {connectionsQuery.isPending ? <LoadingItems /> : null}
          {connectionsQuery.data?.connections.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Link2Icon />
                </EmptyMedia>
                <EmptyTitle>No connections yet</EmptyTitle>
                <EmptyDescription>
                  Choose a configured provider to create the first connection.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}
          {connectionsQuery.data?.connections.length ? (
            <ItemGroup>
              {connectionsQuery.data.connections.map((connection) => (
                <ConnectionItem
                  key={connection.connection_id}
                  connection={connection}
                  disconnecting={
                    disconnectMutation.isPending &&
                    disconnectMutation.variables === connection.connection_id
                  }
                  onDisconnect={() =>
                    disconnectMutation.mutate(connection.connection_id)
                  }
                />
              ))}
            </ItemGroup>
          ) : null}
        </CardContent>
      </Card>

      {queryError ? (
        <Alert variant="destructive" className="lg:col-span-2">
          <AlertTitle>Could not load OAuth data</AlertTitle>
          <AlertDescription>{queryError.message}</AlertDescription>
        </Alert>
      ) : null}
      {mutationError ? (
        <Alert variant="destructive" className="lg:col-span-2">
          <AlertTitle>OAuth action failed</AlertTitle>
          <AlertDescription>{mutationError.message}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  )
}
