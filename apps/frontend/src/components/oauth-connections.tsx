import { useQueryClient } from '@tanstack/react-query'
import {
  ChevronRightIcon,
  FolderIcon,
  FolderPlusIcon,
  HouseIcon,
  Link2Icon,
  ListIcon,
  PlusIcon,
  RefreshCwIcon,
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
  validateConnectionPath,
} from '@/lib/connection-tree'
import { hookfish } from '@/lib/hookfish'
import {
  addLocalFolder,
  LOCAL_FOLDERS_KEY,
  readLocalFolders,
} from '@/lib/local-folders'
import {
  authorizeConnection,
  type PendingAuthorization,
  setConnectionSecret,
} from '@/lib/management-api'

const ALL_PROVIDERS = '__all__'
type ConnectionView = 'tree' | 'all'

type ProviderInputField = {
  name: string
  label: string
  type: 'text' | 'url' | 'string_list'
  target: 'identity' | 'configuration' | 'scopes'
  required: boolean
  placeholder?: string
  description?: string
}

type ProviderMetadata = {
  id: string
  label: string
  authentication: 'oauth' | 'secret'
  input_schema: { fields: ProviderInputField[] }
}

function validateProviderInput(
  field: ProviderInputField,
  value: string,
): string | undefined {
  const normalized = value.trim()
  if (!normalized) {
    return field.required ? `${field.label} is required.` : undefined
  }
  if (field.target === 'identity') {
    return validateConnectionPath(normalized)
  }
  if (field.type === 'url') {
    try {
      new URL(normalized)
    } catch {
      return 'Enter a valid absolute URL.'
    }
  }
  return undefined
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
              connection namespaces.
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
  providers,
  existingPaths,
  pendingPaths,
  onAuthorized,
  onSaved,
  onOpenChange,
}: {
  open: boolean
  currentPath: string
  providers: ProviderMetadata[]
  existingPaths: string[]
  pendingPaths: string[]
  onAuthorized: (authorization: PendingAuthorization) => void
  onSaved: () => Promise<void>
  onOpenChange: (open: boolean) => void
}) {
  const [providerId, setProviderId] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [secret, setSecret] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const selectedProvider = providers.find(
    (provider) => provider.id === providerId,
  )
  const fields = selectedProvider?.input_schema.fields ?? []
  const identityField = fields.find((field) => field.target === 'identity')
  const identity = identityField
    ? (values[identityField.name] ?? '').trim()
    : ''
  const fieldErrors = new Map(
    fields.map((field) => [
      field.name,
      validateProviderInput(field, values[field.name] ?? ''),
    ]),
  )
  const namespace = identity
    ? joinConnectionPath(currentPath, identity)
    : currentPath
  const path = providerId ? joinConnectionPath(namespace, providerId) : ''
  const pathTaken = existingPaths.includes(path) || pendingPaths.includes(path)
  const invalidProviderInput = [...fieldErrors.values()].some(Boolean)

  function fieldValue(field: ProviderInputField): string | string[] {
    const value = (values[field.name] ?? '').trim()
    if (field.type !== 'string_list') return value
    return value
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (invalidProviderInput || !selectedProvider || !path || pathTaken) return
    setPending(true)
    setError(null)
    try {
      if (selectedProvider.authentication === 'secret') {
        await setConnectionSecret(path, secret)
        await onSaved()
        onOpenChange(false)
      } else {
        const configuration = Object.fromEntries(
          fields
            .filter((field) => field.target === 'configuration')
            .map((field) => [field.name, fieldValue(field)])
            .filter(([, value]) =>
              Array.isArray(value) ? value.length > 0 : value.length > 0,
            ),
        )
        const scopesField = fields.find((field) => field.target === 'scopes')
        const requestedScopes = scopesField
          ? fieldValue(scopesField)
          : undefined
        const authorization = await authorizeConnection(path, providerId, {
          ...(Object.keys(configuration).length > 0 ? { configuration } : {}),
          ...(Array.isArray(requestedScopes)
            ? {
                scopes: requestedScopes.filter(
                  (scope) => typeof scope === 'string',
                ),
              }
            : {}),
          returnTo: window.location.href,
        })
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
    invalidProviderInput ||
    pathTaken ||
    !selectedProvider ||
    (selectedProvider.authentication === 'secret' && !secret.trim())

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent>
        <form className="grid gap-8" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add connection</DialogTitle>
            <DialogDescription>
              Choose a trusted provider for {currentPath || 'Connections'}.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="resource-provider">Provider</FieldLabel>
              <Select
                value={providerId}
                onValueChange={(value) => {
                  setProviderId(value)
                  setValues({})
                  setSecret('')
                }}
              >
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
              {selectedProvider ? (
                <FieldDescription>
                  {selectedProvider.authentication === 'oauth'
                    ? 'OAuth provider — authorization is required before use.'
                    : 'Secret provider — enter a credential to save it.'}
                </FieldDescription>
              ) : null}
            </Field>
            {fields.map((field) => {
              const fieldId = `provider-input-${field.name}`
              const value = values[field.name] ?? ''
              const fieldError = fieldErrors.get(field.name)
              return (
                <Field key={field.name} data-invalid={Boolean(fieldError)}>
                  <FieldLabel htmlFor={fieldId}>
                    {field.label}
                    {field.target === 'scopes' && !field.required
                      ? ' (optional)'
                      : ''}
                  </FieldLabel>
                  <Input
                    id={fieldId}
                    type={field.type === 'url' ? 'url' : 'text'}
                    value={value}
                    required={field.required}
                    placeholder={field.placeholder}
                    autoComplete="off"
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [field.name]: event.target.value,
                      }))
                    }
                  />
                  {field.description || field.target === 'identity' ? (
                    <FieldDescription>
                      {field.description ??
                        'Use slashes to create a nested path directly, such as team/production.'}
                    </FieldDescription>
                  ) : null}
                  <FieldError className="text-destructive">
                    {fieldError}
                  </FieldError>
                </Field>
              )
            })}
            {selectedProvider?.authentication === 'secret' ? (
              <Field data-invalid={!secret.trim()}>
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
                <FieldError className="text-destructive">
                  {!secret.trim() ? 'Secret value is required.' : undefined}
                </FieldError>
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
              {pending
                ? 'Saving…'
                : selectedProvider?.authentication === 'oauth'
                  ? 'Authorize'
                  : 'Save credential'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ConnectionItem({
  connection,
  authorization,
  disconnecting,
  oauth,
  onAuthorization,
  onDisconnect,
}: {
  connection: Connection
  authorization?: PendingAuthorization
  disconnecting: boolean
  oauth: boolean
  onAuthorization: (authorization: PendingAuthorization) => void
  onDisconnect: () => void
}) {
  const name = connection.namespace.split('/').at(-1) || connection.path
  const account =
    connection.external_account_label ?? connection.external_account_id
  const [reauthorizing, setReauthorizing] = useState(false)
  const [reauthorizeError, setReauthorizeError] = useState<string>()

  async function reauthorize() {
    setReauthorizing(true)
    setReauthorizeError(undefined)
    try {
      const nextAuthorization = await authorizeConnection(
        connection.path,
        connection.provider_id,
        { returnTo: window.location.href },
      )
      onAuthorization(nextAuthorization)
      window.location.assign(nextAuthorization.authorizeUrl)
    } catch (cause) {
      setReauthorizeError(
        cause instanceof Error ? cause.message : String(cause),
      )
      setReauthorizing(false)
    }
  }

  return (
    <Item variant="outline">
      <ItemMedia variant="icon">
        <Link2Icon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          {name}
          <Badge variant="outline">{connection.provider_id}</Badge>
          {authorization ? (
            <Badge variant="secondary">Auth required</Badge>
          ) : null}
        </ItemTitle>
        <ItemDescription>
          {account ? `${account} · ` : ''}
          {connection.path}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        {oauth && !authorization ? (
          <Button
            size="sm"
            variant="outline"
            disabled={reauthorizing || disconnecting}
            onClick={() => void reauthorize()}
          >
            {reauthorizing ? <Spinner /> : <RefreshCwIcon />}
            {reauthorizing ? 'Re-authorizing…' : 'Re-authorize'}
          </Button>
        ) : null}
        {authorization ? (
          <Button asChild size="sm">
            <a href={authorization.authorizeUrl}>
              Authorize
              <ChevronRightIcon />
            </a>
          </Button>
        ) : null}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="destructive" disabled={disconnecting}>
              {disconnecting ? <Spinner /> : null}
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
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
      {reauthorizeError ? (
        <div className="basis-full text-sm text-destructive" role="alert">
          {reauthorizeError}
        </div>
      ) : null}
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
  currentPath,
  onNavigate,
}: {
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
  const disconnect = hookfish.useDisconnectConnection()
  const connectionItems = connections.data?.connections ?? []
  const activePending = pendingAuthorizations.filter(
    (item) => Date.parse(item.expiresAt) > Date.now(),
  )
  const directory = useMemo(
    () =>
      connectionDirectory(
        connectionItems,
        currentPath,
        localFolders,
        activePending.map((item) => item.path),
      ),
    [connectionItems, currentPath, localFolders, activePending],
  )
  const visiblePending =
    view === 'tree'
      ? directResources(activePending, currentPath)
      : activePending
  const visibleConnections =
    view === 'tree'
      ? directory.connections
      : [...connectionItems].sort((a, b) => a.path.localeCompare(b.path))
  const visibleConnectionPaths = new Set(
    visibleConnections.map((connection) => connection.path),
  )
  const standalonePending = visiblePending.filter(
    (authorization) => !visibleConnectionPaths.has(authorization.path),
  )
  const empty =
    !connections.isPending &&
    (view === 'tree' ? directory.folders.length === 0 : true) &&
    visibleConnections.length === 0 &&
    visiblePending.length === 0

  function updateFolders(next: string[]) {
    setLocalFolders(next)
    window.localStorage.setItem(LOCAL_FOLDERS_KEY, JSON.stringify(next))
  }

  async function refreshConnections() {
    await queryClient.invalidateQueries({
      queryKey: hookfish.keys.connectionsRoot(),
    })
  }

  function rememberAuthorization(authorization: PendingAuthorization) {
    setPendingAuthorizations((items) => [
      ...items.filter((item) => item.path !== authorization.path),
      authorization,
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

          {connections.isPending || providers.isPending ? (
            <LoadingItems />
          ) : null}
          {connections.error ? (
            <Alert variant="destructive">
              <AlertTitle>Could not load connections</AlertTitle>
              <AlertDescription>{connections.error.message}</AlertDescription>
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
                  Add a folder or trusted provider connection.
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
                  authorization={activePending.find(
                    (item) => item.path === connection.path,
                  )}
                  disconnecting={
                    disconnect.isPending &&
                    disconnect.variables === connection.path
                  }
                  oauth={
                    providers.data?.providers.find(
                      (provider) => provider.id === connection.provider_id,
                    )?.authentication === 'oauth'
                  }
                  onAuthorization={rememberAuthorization}
                  onDisconnect={() => disconnect.mutate(connection.path)}
                />
              ))}
              {standalonePending.map((authorization) => (
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
        providers={providers.data?.providers ?? []}
        existingPaths={[...connectionItems.map((item) => item.path)]}
        pendingPaths={activePending.map((item) => item.path)}
        onAuthorized={(authorization) => {
          rememberAuthorization(authorization)
          void refreshConnections()
        }}
        onSaved={refreshConnections}
        onOpenChange={setResourceOpen}
      />
    </section>
  )
}
