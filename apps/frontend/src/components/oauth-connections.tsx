import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronRightIcon,
  FolderIcon,
  FolderPlusIcon,
  HouseIcon,
  KeyRoundIcon,
  Link2Icon,
  ListIcon,
  PlusIcon,
  ShieldCheckIcon,
} from 'lucide-react'
import { type FormEvent, Fragment, useMemo, useState } from 'react'
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
import { Card, CardContent } from '@/components/ui/card'
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
} from '@/lib/connection-tree'
import { hookfish } from '@/lib/hookfish'
import {
  addLocalFolder,
  LOCAL_FOLDERS_KEY,
  readLocalFolders,
} from '@/lib/local-folders'
import {
  authorizeConnection,
  deleteSecret,
  listSecrets,
  type PendingAuthorization,
  type SecretMetadata,
  setConnectionSecret,
  storeSecret,
} from '@/lib/management-api'

const ALL_PROVIDERS = '__all__'
type ConnectionView = 'tree' | 'all'
type ResourceKind = 'oauth' | 'static' | 'vault'

function isResourceKind(value: string): value is ResourceKind {
  return value === 'oauth' || value === 'static' || value === 'vault'
}

function directResources<T extends { path: string }>(
  resources: T[],
  currentPath: string,
): T[] {
  const prefix = currentPath ? `${currentPath}/` : ''
  return resources.filter((resource) => {
    if (!resource.path.startsWith(prefix)) return false
    return !resource.path.slice(prefix.length).includes('/')
  })
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
            <BreadcrumbPage className="flex items-center gap-2">
              <HouseIcon className="size-4" />
              Connections
            </BreadcrumbPage>
          ) : (
            <BreadcrumbLink asChild>
              <button
                type="button"
                className="flex min-h-11 items-center gap-2 md:min-h-0"
                onClick={() => onNavigate('')}
              >
                <HouseIcon className="size-4" />
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

function AddFolderDialog({
  open,
  currentPath,
  folders,
  onAdd,
  onOpenChange,
}: {
  open: boolean
  currentPath: string
  folders: string[]
  onAdd: (folders: string[]) => void
  onOpenChange: (open: boolean) => void
}) {
  const [name, setName] = useState('')
  const error = name ? validateConnectionName(name.trim()) : undefined
  const path = joinConnectionPath(currentPath, name.trim())
  const exists = folders.includes(path)
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (error || exists) return
    onAdd(addLocalFolder(folders, currentPath, name))
    onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form className="grid gap-8" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add folder</DialogTitle>
            <DialogDescription>
              Create a folder in {currentPath || 'Connections'} to organize
              connection namespaces and vault secrets.
            </DialogDescription>
          </DialogHeader>
          <Field data-invalid={Boolean(error || exists)}>
            <FieldLabel htmlFor="folder-name">Folder name</FieldLabel>
            <Input
              id="folder-name"
              value={name}
              required
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
            />
            <FieldError>
              {error ?? (exists ? 'This folder already exists.' : undefined)}
            </FieldError>
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || Boolean(error || exists)}
            >
              <FolderPlusIcon />
              Add folder
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AddResourceDialog({
  open,
  currentPath,
  managementToken,
  providers,
  existingPaths,
  pendingPaths,
  onAuthorized,
  onSaved,
  onOpenChange,
}: {
  open: boolean
  currentPath: string
  managementToken: string
  providers: Array<{ id: string; label: string; configurable: boolean }>
  existingPaths: string[]
  pendingPaths: string[]
  onAuthorized: (authorization: PendingAuthorization) => void
  onSaved: () => Promise<void>
  onOpenChange: (open: boolean) => void
}) {
  const [kind, setKind] = useState<ResourceKind>('oauth')
  const [name, setName] = useState('')
  const [providerId, setProviderId] = useState('')
  const [url, setUrl] = useState('')
  const [scopes, setScopes] = useState('')
  const [secret, setSecret] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const selectedProvider = providers.find(
    (provider) => provider.id === providerId,
  )
  const normalizedName = name.trim()
  const nameError = normalizedName
    ? validateConnectionName(normalizedName)
    : undefined
  const namespace = normalizedName
    ? joinConnectionPath(currentPath, normalizedName)
    : currentPath
  const path =
    kind === 'vault'
      ? namespace
      : providerId
        ? joinConnectionPath(namespace, providerId)
        : namespace
  const nameRequired = kind === 'vault'
  const pathTaken = existingPaths.includes(path) || pendingPaths.includes(path)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (nameError || (nameRequired && !normalizedName) || !path || pathTaken)
      return
    setPending(true)
    setError(null)
    try {
      if (kind === 'vault') {
        await storeSecret(managementToken, path, secret)
        await onSaved()
        onOpenChange(false)
      } else if (kind === 'static') {
        await setConnectionSecret(managementToken, path, secret)
        await onSaved()
        onOpenChange(false)
      } else {
        const authorization = await authorizeConnection(
          managementToken,
          path,
          providerId,
          {
            ...(selectedProvider?.configurable ? { url } : {}),
            scopes: scopes
              .split(/[\s,]+/)
              .map((scope) => scope.trim())
              .filter(Boolean),
            returnTo: window.location.href,
          },
        )
        onAuthorized(authorization)
        onOpenChange(false)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)))
    } finally {
      setPending(false)
    }
  }

  const invalid =
    Boolean(nameError) ||
    (nameRequired && !normalizedName) ||
    pathTaken ||
    (kind !== 'vault' && !providerId) ||
    (kind === 'oauth' && Boolean(selectedProvider?.configurable) && !url) ||
    ((kind === 'static' || kind === 'vault') && !secret)

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent>
        <form className="grid gap-8" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add connection</DialogTitle>
            <DialogDescription>
              Add a trusted provider connection or encrypted secret to{' '}
              {currentPath || 'Connections'}.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="resource-kind">Type</FieldLabel>
              <Select
                value={kind}
                onValueChange={(value) => {
                  if (isResourceKind(value)) setKind(value)
                }}
              >
                <SelectTrigger id="resource-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="oauth">OAuth / MCP connection</SelectItem>
                  <SelectItem value="static">Static provider secret</SelectItem>
                  <SelectItem value="vault">Generic vault secret</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field
              data-invalid={Boolean(
                nameError || (nameRequired && !normalizedName),
              )}
            >
              <FieldLabel htmlFor="resource-name">
                {kind === 'vault' ? 'Secret name' : 'Namespace (optional)'}
              </FieldLabel>
              <Input
                id="resource-name"
                value={name}
                required={nameRequired}
                placeholder={
                  kind === 'vault' ? 'production' : 'Optional namespace'
                }
                autoComplete="off"
                onChange={(event) => setName(event.target.value)}
              />
              <FieldDescription>
                {kind === 'vault'
                  ? 'The encrypted value is stored at this path.'
                  : 'Provider IDs are the final segment of a connection path.'}
              </FieldDescription>
              <FieldError>
                {nameError ??
                  (nameRequired && !normalizedName
                    ? 'Enter a secret name.'
                    : undefined)}
              </FieldError>
            </Field>
            {kind !== 'vault' ? (
              <Field>
                <FieldLabel htmlFor="resource-provider">Provider</FieldLabel>
                <Select value={providerId} onValueChange={setProviderId}>
                  <SelectTrigger id="resource-provider" className="w-full">
                    <SelectValue placeholder="Select a configured provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>
                        {provider.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
            {kind === 'oauth' && selectedProvider?.configurable ? (
              <Field>
                <FieldLabel htmlFor="resource-url">MCP server URL</FieldLabel>
                <Input
                  id="resource-url"
                  type="url"
                  value={url}
                  required
                  placeholder="https://mcp.example.com/mcp"
                  onChange={(event) => setUrl(event.target.value)}
                />
              </Field>
            ) : null}
            {kind === 'oauth' ? (
              <Field>
                <FieldLabel htmlFor="resource-scopes">Scopes</FieldLabel>
                <Input
                  id="resource-scopes"
                  value={scopes}
                  placeholder="read, write (optional)"
                  onChange={(event) => setScopes(event.target.value)}
                />
              </Field>
            ) : null}
            {kind === 'static' || kind === 'vault' ? (
              <Field>
                <FieldLabel htmlFor="resource-secret">Secret value</FieldLabel>
                <Input
                  id="resource-secret"
                  type="password"
                  value={secret}
                  required
                  autoComplete="off"
                  onChange={(event) => setSecret(event.target.value)}
                />
                <FieldDescription>
                  Encrypted at rest and never displayed again.
                </FieldDescription>
              </Field>
            ) : null}
            {path ? (
              <p className="text-xs text-muted-foreground">
                Full path: <code>{path}</code>
              </p>
            ) : null}
            {pathTaken ? (
              <p className="text-sm text-destructive">
                This path is already in use.
              </p>
            ) : null}
          </FieldGroup>
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Could not add connection</AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || invalid}>
              {pending ? <Spinner /> : <PlusIcon />}
              {pending ? 'Saving…' : 'Add connection'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ConnectionItem({
  connection,
  pending,
  onDisconnect,
}: {
  connection: Connection
  pending: boolean
  onDisconnect: () => void
}) {
  const name = connection.namespace.split('/').at(-1) ?? connection.path
  const account =
    connection.external_account_label ?? connection.external_account_id
  return (
    <Item variant="outline">
      <ItemMedia variant="icon">
        <Link2Icon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          {name}
          <Badge variant="outline">{connection.provider_id}</Badge>
        </ItemTitle>
        <ItemDescription>
          {account ? `${account} · ` : ''}
          {connection.path}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="destructive" disabled={pending}>
              {pending ? <Spinner /> : null}
              {pending ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogMedia>
                <ShieldCheckIcon />
              </AlertDialogMedia>
              <AlertDialogTitle>Disconnect {name}?</AlertDialogTitle>
              <AlertDialogDescription>
                Hookfish will revoke the provider credential when supported and
                remove {connection.path}.
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

function SecretItem({
  secret,
  pending,
  onDelete,
}: {
  secret: SecretMetadata
  pending: boolean
  onDelete: () => void
}) {
  const name = secret.path.split('/').at(-1) ?? secret.path
  return (
    <Item variant="outline">
      <ItemMedia variant="icon">
        <KeyRoundIcon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          {name}
          <Badge variant="outline">Vault secret</Badge>
        </ItemTitle>
        <ItemDescription>
          Encrypted in the Hookfish vault · {secret.path}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="destructive" disabled={pending}>
              {pending ? <Spinner /> : null}
              {pending ? 'Deleting…' : 'Delete'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogMedia>
                <ShieldCheckIcon />
              </AlertDialogMedia>
              <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes the encrypted value.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={onDelete}>
                Delete secret
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </ItemActions>
    </Item>
  )
}

function PendingItem({
  authorization,
  onDismiss,
}: {
  authorization: PendingAuthorization
  onDismiss: () => void
}) {
  return (
    <Item variant="outline">
      <ItemMedia variant="icon">
        <Link2Icon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          {authorization.path.split('/').at(-2) ?? authorization.path}
          <Badge variant="secondary">Auth required</Badge>
        </ItemTitle>
        <ItemDescription>{authorization.path}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button asChild size="sm">
          <a href={authorization.authorizeUrl}>
            Authorize
            <ChevronRightIcon />
          </a>
        </Button>
        <Button size="sm" variant="outline" onClick={onDismiss}>
          Dismiss
        </Button>
      </ItemActions>
    </Item>
  )
}

function LoadingItems() {
  return (
    <div className="grid gap-4">
      {[0, 1, 2].map((index) => (
        <div
          className="flex min-h-16 items-center gap-4 border p-4"
          key={index}
        >
          <Skeleton className="size-8" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function OAuthConnections({
  managementToken,
  currentPath,
  onNavigate,
}: {
  managementToken: string
  currentPath: string
  onNavigate: (path: string) => void
}) {
  const queryClient = useQueryClient()
  const [view, setView] = useState<ConnectionView>('tree')
  const [providerFilter, setProviderFilter] = useState(ALL_PROVIDERS)
  const [folderOpen, setFolderOpen] = useState(false)
  const [resourceOpen, setResourceOpen] = useState(false)
  const [pendingAuthorizations, setPendingAuthorizations] = useState<
    PendingAuthorization[]
  >([])
  const [localFolders, setLocalFolders] = useState<string[]>(() =>
    typeof window === 'undefined' ? [] : readLocalFolders(window.localStorage),
  )
  const connections = hookfish.useConnections({
    ...(view === 'tree' && currentPath ? { namespace: currentPath } : {}),
    ...(providerFilter === ALL_PROVIDERS
      ? {}
      : { provider_id: providerFilter }),
  })
  const providers = hookfish.useProviders()
  const secrets = useQuery({
    queryKey: [
      'management',
      'secrets',
      managementToken,
      view === 'tree' ? currentPath : '',
    ],
    queryFn: () =>
      listSecrets(
        managementToken,
        view === 'tree' ? currentPath || undefined : undefined,
      ),
    enabled: Boolean(managementToken),
  })
  const disconnect = hookfish.useDisconnectConnection()
  const deleteSecretMutation = useMutation({
    mutationFn: (path: string) => deleteSecret(managementToken, path),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['management', 'secrets'] }),
  })
  const connectionItems = connections.data?.connections ?? []
  const secretItems = secrets.data ?? []
  const activePending = pendingAuthorizations.filter(
    (item) => Date.parse(item.expiresAt) > Date.now(),
  )
  const directory = useMemo(
    () =>
      connectionDirectory(connectionItems, currentPath, localFolders, [
        ...secretItems.map((item) => item.path),
        ...activePending.map((item) => item.path),
      ]),
    [connectionItems, currentPath, localFolders, secretItems, activePending],
  )
  const visibleSecrets =
    view === 'tree' ? directResources(secretItems, currentPath) : secretItems
  const visiblePending =
    view === 'tree'
      ? directResources(activePending, currentPath)
      : activePending
  const visibleConnections =
    view === 'tree'
      ? directory.connections
      : [...connectionItems].sort((a, b) => a.path.localeCompare(b.path))
  const empty =
    !connections.isPending &&
    !secrets.isPending &&
    (view === 'tree' ? directory.folders.length === 0 : true) &&
    visibleConnections.length === 0 &&
    visibleSecrets.length === 0 &&
    visiblePending.length === 0

  function updateFolders(next: string[]) {
    setLocalFolders(next)
    window.localStorage.setItem(LOCAL_FOLDERS_KEY, JSON.stringify(next))
  }

  async function refreshResources() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: hookfish.keys.connectionsRoot(),
      }),
      queryClient.invalidateQueries({ queryKey: ['management', 'secrets'] }),
    ])
  }

  return (
    <section
      aria-labelledby="connections-heading"
      className="grid h-full min-h-0 min-w-0 overflow-hidden"
    >
      <Card className="h-full min-h-0 min-w-0 gap-0 rounded-none border-x-0 border-b-0 border-t-2 border-t-primary py-0">
        <CardContent className="grid min-h-0 min-w-0 flex-1 content-start gap-8 overflow-x-hidden overflow-y-auto px-4 pb-8 md:px-8">
          <h2 id="connections-heading" className="sr-only">
            Connections
          </h2>
          <div className="grid border-b">
            <div className="grid min-w-0 gap-4 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
              {view === 'tree' ? (
                <PathBreadcrumb
                  currentPath={currentPath}
                  onNavigate={onNavigate}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Every stored resource
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {view === 'tree' ? (
                  <Button variant="outline" onClick={() => setFolderOpen(true)}>
                    <FolderPlusIcon />
                    Add folder
                  </Button>
                ) : null}
                <Button onClick={() => setResourceOpen(true)}>
                  <PlusIcon />
                  Add connection
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t py-3">
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
                <SelectTrigger size="sm" className="w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_PROVIDERS}>All providers</SelectItem>
                  {(providers.data?.providers ?? []).map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {connections.isPending || secrets.isPending || providers.isPending ? (
            <LoadingItems />
          ) : null}
          {connections.error ? (
            <Alert variant="destructive">
              <AlertTitle>Could not load connections</AlertTitle>
              <AlertDescription>{connections.error.message}</AlertDescription>
            </Alert>
          ) : null}
          {secrets.error ? (
            <Alert variant="destructive">
              <AlertTitle>Could not load vault secrets</AlertTitle>
              <AlertDescription>{secrets.error.message}</AlertDescription>
            </Alert>
          ) : null}
          {providers.error ? (
            <Alert variant="destructive">
              <AlertTitle>Could not load providers</AlertTitle>
              <AlertDescription>{providers.error.message}</AlertDescription>
            </Alert>
          ) : null}

          {empty ? (
            <Empty className="border py-16">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FolderIcon />
                </EmptyMedia>
                <EmptyTitle>
                  {view === 'tree' ? 'This folder is empty' : 'No connections'}
                </EmptyTitle>
                <EmptyDescription>
                  Add a folder, trusted provider connection, or encrypted
                  secret.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={() => setResourceOpen(true)}>
                  <PlusIcon />
                  Add connection
                </Button>
              </EmptyContent>
            </Empty>
          ) : null}

          {!empty ? (
            <ItemGroup>
              {view === 'tree'
                ? directory.folders.map((folder) => (
                    <Item asChild variant="outline" key={folder.path}>
                      <button
                        type="button"
                        onClick={() => onNavigate(folder.path)}
                      >
                        <ItemMedia variant="icon">
                          <FolderIcon />
                        </ItemMedia>
                        <ItemContent>
                          <ItemTitle>{folder.name}</ItemTitle>
                          <ItemDescription>
                            {folder.itemCount === 0
                              ? 'Folder'
                              : `${folder.itemCount} item${folder.itemCount === 1 ? '' : 's'}`}
                          </ItemDescription>
                        </ItemContent>
                        <ItemActions>
                          <ChevronRightIcon className="size-4 text-muted-foreground" />
                        </ItemActions>
                      </button>
                    </Item>
                  ))
                : null}
              {visibleConnections.map((connection) => (
                <ConnectionItem
                  key={connection.path}
                  connection={connection}
                  pending={
                    disconnect.isPending &&
                    disconnect.variables === connection.path
                  }
                  onDisconnect={() => disconnect.mutate(connection.path)}
                />
              ))}
              {visiblePending.map((authorization) => (
                <PendingItem
                  key={authorization.path}
                  authorization={authorization}
                  onDismiss={() =>
                    setPendingAuthorizations((items) =>
                      items.filter((item) => item.path !== authorization.path),
                    )
                  }
                />
              ))}
              {visibleSecrets.map((secret) => (
                <SecretItem
                  key={secret.path}
                  secret={secret}
                  pending={
                    deleteSecretMutation.isPending &&
                    deleteSecretMutation.variables === secret.path
                  }
                  onDelete={() => deleteSecretMutation.mutate(secret.path)}
                />
              ))}
            </ItemGroup>
          ) : null}
        </CardContent>
      </Card>
      <AddFolderDialog
        key={`${folderOpen}:${currentPath}`}
        open={folderOpen}
        currentPath={currentPath}
        folders={localFolders}
        onAdd={updateFolders}
        onOpenChange={setFolderOpen}
      />
      <AddResourceDialog
        key={`${resourceOpen}:${currentPath}`}
        open={resourceOpen}
        currentPath={view === 'tree' ? currentPath : ''}
        managementToken={managementToken}
        providers={providers.data?.providers ?? []}
        existingPaths={[
          ...connectionItems.map((item) => item.path),
          ...secretItems.map((item) => item.path),
        ]}
        pendingPaths={activePending.map((item) => item.path)}
        onAuthorized={(authorization) =>
          setPendingAuthorizations((items) => [
            ...items.filter((item) => item.path !== authorization.path),
            authorization,
          ])
        }
        onSaved={refreshResources}
        onOpenChange={setResourceOpen}
      />
    </section>
  )
}
