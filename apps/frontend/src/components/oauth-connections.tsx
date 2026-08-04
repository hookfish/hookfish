import type {
  AuthorizeConnectionInput,
  ProvidersResponse,
} from '@hookfish/hooks'
import {
  ChevronRightIcon,
  FolderIcon,
  HouseIcon,
  Link2Icon,
  ListIcon,
  PlusIcon,
  ShieldCheckIcon,
} from 'lucide-react'
import { Fragment, type FormEvent, useMemo, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { Badge } from '@/components/ui/badge'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  type Connection,
  connectionDirectory,
  joinConnectionPath,
  validateConnectionName,
  validateConnectionPath,
} from '@/lib/connection-tree'
import { hookfish } from '@/lib/hookfish'

type Provider = ProvidersResponse['providers'][number]
type AuthorizeMutation = ReturnType<typeof hookfish.useAuthorizeConnection>

const ALL_PROVIDERS = '__all__'
type ConnectionView = 'tree' | 'all'

function ConnectionItem({
  connection,
  disconnecting,
  onDisconnect,
}: {
  connection: Connection
  disconnecting: boolean
  onDisconnect: () => void
}) {
  const connectionName =
    connection.connection_id.split('/').at(-1) ?? connection.connection_id
  const accountLabel =
    connection.external_account_label ?? connection.external_account_id

  return (
    <Item variant="outline">
      <ItemMedia variant="icon">
        <Link2Icon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          {connectionName}
          <Badge variant="outline">{connection.provider}</Badge>
        </ItemTitle>
        <ItemDescription>
          {accountLabel ? `${accountLabel} · ` : ''}
          {connection.connection_id}
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
              <AlertDialogTitle>Disconnect {connectionName}?</AlertDialogTitle>
              <AlertDialogDescription>
                Hookfish will revoke the provider credential when supported and
                remove {connection.connection_id}.
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

function PathBreadcrumb({
  currentPath,
  onNavigate,
}: {
  currentPath: string
  onNavigate: (path: string) => void
}) {
  const segments = currentPath ? currentPath.split('/') : []

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          {segments.length === 0 ? (
            <BreadcrumbPage className="flex items-center gap-1.5">
              <HouseIcon className="size-3.5" />
              Connections
            </BreadcrumbPage>
          ) : (
            <BreadcrumbLink asChild>
              <button
                type="button"
                className="flex items-center gap-1.5"
                onClick={() => onNavigate('')}
              >
                <HouseIcon className="size-3.5" />
                Connections
              </button>
            </BreadcrumbLink>
          )}
        </BreadcrumbItem>
        {segments.map((segment, index) => {
          const path = segments.slice(0, index + 1).join('/')
          const current = index === segments.length - 1

          return (
            <Fragment key={path}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {current ? (
                  <BreadcrumbPage>{segment}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <button type="button" onClick={() => onNavigate(path)}>
                      {segment}
                    </button>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

function AddConnectionDialog({
  open,
  currentPath,
  providers,
  mutation,
  onOpenChange,
}: {
  open: boolean
  currentPath: string
  providers: Provider[]
  mutation: AuthorizeMutation
  onOpenChange: (open: boolean) => void
}) {
  const configuredProviders = providers.filter(
    (provider) => provider.configured,
  )
  const [path, setPath] = useState(currentPath)
  const [name, setName] = useState('')
  const [providerId, setProviderId] = useState(configuredProviders[0]?.id ?? '')
  const normalizedPath = path.trim()
  const normalizedName = name.trim()
  const connectionId = joinConnectionPath(normalizedPath, normalizedName)
  const pathError = validateConnectionPath(normalizedPath)
  const nameError = validateConnectionName(normalizedName)
  const error = pathError ?? nameError

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (error || !providerId) return

    const input: AuthorizeConnectionInput = {
      provider: providerId,
      connection_id: connectionId,
    }
    mutation.mutate(input)
  }

  function handleOpenChange(nextOpen: boolean) {
    if (mutation.isPending) return
    if (nextOpen) {
      setPath(currentPath)
      setName('')
      setProviderId(configuredProviders[0]?.id ?? '')
      mutation.reset()
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add connection</DialogTitle>
            <DialogDescription>
              Name the connection and place it in the current path or a new
              nested path.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <Field data-invalid={Boolean(pathError)}>
              <FieldLabel htmlFor="connection-path">Path</FieldLabel>
              <Input
                id="connection-path"
                value={path}
                placeholder="team/payments"
                aria-invalid={Boolean(pathError)}
                onChange={(event) => setPath(event.target.value)}
              />
              <FieldDescription>
                Slash-delimited folders. Leave blank for the root.
              </FieldDescription>
              <FieldError>{pathError}</FieldError>
            </Field>

            <Field data-invalid={Boolean(nameError)}>
              <FieldLabel htmlFor="connection-name">Connection name</FieldLabel>
              <Input
                id="connection-name"
                value={name}
                placeholder="production"
                autoComplete="off"
                aria-invalid={Boolean(nameError)}
                onChange={(event) => setName(event.target.value)}
              />
              <FieldDescription>
                Full ID: <code>{connectionId || 'connection-name'}</code>
              </FieldDescription>
              <FieldError>{nameError}</FieldError>
            </Field>

            <Field>
              <FieldLabel htmlFor="connection-provider">Provider</FieldLabel>
              <Select value={providerId} onValueChange={setProviderId}>
                <SelectTrigger id="connection-provider" className="w-full">
                  <SelectValue placeholder="Select a provider" />
                </SelectTrigger>
                <SelectContent>
                  {configuredProviders.map((provider) => (
                    <SelectItem value={provider.id} key={provider.id}>
                      {provider.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {configuredProviders.length === 0 ? (
                <FieldError>
                  Configure provider credentials before adding a connection.
                </FieldError>
              ) : null}
            </Field>
          </FieldGroup>

          {mutation.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Could not start authorization</AlertTitle>
              <AlertDescription>{mutation.error.message}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={Boolean(error) || !providerId || mutation.isPending}
            >
              {mutation.isPending ? <Spinner /> : <PlusIcon />}
              {mutation.isPending ? 'Opening provider' : 'Add connection'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function OAuthConnections() {
  const [currentPath, setCurrentPath] = useState('')
  const [providerFilter, setProviderFilter] = useState(ALL_PROVIDERS)
  const [view, setView] = useState<ConnectionView>('tree')
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const providersQuery = hookfish.useProviders()
  const connectionsQuery = hookfish.useConnections({
    ...(view === 'tree' && currentPath
      ? { connection_id_prefix: currentPath }
      : {}),
    ...(providerFilter === ALL_PROVIDERS ? {} : { provider: providerFilter }),
  })
  const authorizeMutation = hookfish.useAuthorizeConnection({
    onSuccess(data) {
      window.location.assign(data.authorize_url)
    },
  })
  const disconnectMutation = hookfish.useDisconnectConnection()
  const directory = useMemo(
    () =>
      connectionDirectory(
        connectionsQuery.data?.connections ?? [],
        currentPath,
      ),
    [connectionsQuery.data?.connections, currentPath],
  )
  const allConnections = useMemo(
    () =>
      [...(connectionsQuery.data?.connections ?? [])].sort((left, right) =>
        left.connection_id.localeCompare(right.connection_id),
      ),
    [connectionsQuery.data?.connections],
  )
  const isEmpty =
    !connectionsQuery.isPending &&
    !connectionsQuery.isError &&
    (view === 'all'
      ? allConnections.length === 0
      : directory.folders.length === 0 && directory.connections.length === 0)
  const addConnectionPath = view === 'tree' ? currentPath : ''

  return (
    <section className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Connections</CardTitle>
          <CardDescription>
            Browse connection paths and add named provider links anywhere in the
            tree.
          </CardDescription>
          <CardAction className="flex items-center gap-2">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              spacing={0}
              value={view}
              onValueChange={(value) => {
                if (value === 'tree' || value === 'all') setView(value)
              }}
              aria-label="Connection view"
            >
              <ToggleGroupItem value="tree" aria-label="Tree view">
                <FolderIcon />
                Tree
              </ToggleGroupItem>
              <ToggleGroupItem value="all" aria-label="View all connections">
                <ListIcon />
                All
              </ToggleGroupItem>
            </ToggleGroup>
            <Select value={providerFilter} onValueChange={setProviderFilter}>
              <SelectTrigger size="sm" aria-label="Filter by provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value={ALL_PROVIDERS}>All providers</SelectItem>
                {providersQuery.data?.providers.map((provider) => (
                  <SelectItem value={provider.id} key={provider.id}>
                    {provider.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={() => setAddDialogOpen(true)}>
              <PlusIcon />
              Add connection
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent className="grid gap-4">
          {view === 'tree' ? (
            <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
              <PathBreadcrumb
                currentPath={currentPath}
                onNavigate={setCurrentPath}
              />
            </div>
          ) : null}

          {connectionsQuery.isPending ? <LoadingItems /> : null}

          {connectionsQuery.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Could not load connections</AlertTitle>
              <AlertDescription>
                {connectionsQuery.error.message}
              </AlertDescription>
            </Alert>
          ) : null}

          {providersQuery.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Could not load providers</AlertTitle>
              <AlertDescription>
                {providersQuery.error.message}
              </AlertDescription>
            </Alert>
          ) : null}

          {isEmpty ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FolderIcon />
                </EmptyMedia>
                <EmptyTitle>
                  {view === 'tree' ? 'This path is empty' : 'No connections'}
                </EmptyTitle>
                <EmptyDescription>
                  {view === 'tree'
                    ? 'Add a named connection here, or change the provider filter.'
                    : 'Add a named connection, or change the provider filter.'}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button size="sm" onClick={() => setAddDialogOpen(true)}>
                  <PlusIcon />
                  Add connection
                </Button>
              </EmptyContent>
            </Empty>
          ) : null}

          {view === 'tree' &&
          (directory.folders.length || directory.connections.length) ? (
            <ItemGroup>
              {directory.folders.map((folder) => (
                <Item asChild variant="outline" key={folder.path}>
                  <button
                    type="button"
                    onClick={() => setCurrentPath(folder.path)}
                  >
                    <ItemMedia variant="icon">
                      <FolderIcon />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{folder.name}</ItemTitle>
                      <ItemDescription>
                        {folder.connectionCount} connection
                        {folder.connectionCount === 1 ? '' : 's'}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <ChevronRightIcon className="size-4 text-muted-foreground" />
                    </ItemActions>
                  </button>
                </Item>
              ))}

              {directory.connections.map((connection) => (
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

          {view === 'all' && allConnections.length ? (
            <ItemGroup>
              {allConnections.map((connection) => (
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

          {disconnectMutation.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Could not disconnect</AlertTitle>
              <AlertDescription>
                {disconnectMutation.error.message}
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <AddConnectionDialog
        key={`${addDialogOpen ? 'open' : 'closed'}:${addConnectionPath}`}
        open={addDialogOpen}
        currentPath={addConnectionPath}
        providers={providersQuery.data?.providers ?? []}
        mutation={authorizeMutation}
        onOpenChange={setAddDialogOpen}
      />
    </section>
  )
}
