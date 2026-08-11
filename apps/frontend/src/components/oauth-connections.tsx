import type {
  AuthorizeConnectionInput,
  AuthorizeConnectionResponse,
} from '@hookfish/hooks'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronRightIcon,
  CircleCheckIcon,
  CircleXIcon,
  FolderIcon,
  FolderPlusIcon,
  HouseIcon,
  KeyRoundIcon,
  Link2Icon,
  ListIcon,
  PlusIcon,
  Settings2Icon,
  ShieldCheckIcon,
} from 'lucide-react'
import {
  type FormEvent,
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { OAuthConfigDialog } from '@/components/credential-management'
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
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
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
  connectionSlug,
  joinConnectionPath,
  validateConnectionName,
  validateConnectionSlug,
} from '@/lib/connection-tree'
import { hookfish } from '@/lib/hookfish'
import {
  addLocalFolder,
  LOCAL_FOLDERS_KEY,
  readLocalFolders,
} from '@/lib/local-folders'
import {
  deleteManagedProvider,
  deleteSecret,
  listManagedProviders,
  listSecrets,
  type ManagedProvider,
  type SecretMetadata,
  storeSecret,
} from '@/lib/management-api'

type AuthorizeMutation = ReturnType<typeof hookfish.useAuthorizeConnection>
type ConnectionKind = 'oauth' | 'api-key'
type PendingAuthorization = AuthorizeConnectionResponse & {
  status: 'auth_required'
  provider: string
}

const ALL_PROVIDERS = '__all__'
const PROVIDER_SEARCH_LIMIT = 50
type ConnectionView = 'tree' | 'all'

function directSecrets(secrets: SecretMetadata[], currentPath: string) {
  const prefix = currentPath ? `${currentPath}/` : ''
  return secrets.filter((secret) => {
    if (!secret.path.startsWith(prefix)) return false
    return !secret.path.slice(prefix.length).includes('/')
  })
}

function directProviders(providers: ManagedProvider[], currentPath: string) {
  const prefix = currentPath ? `${currentPath}/` : ''
  return providers.filter((provider) => {
    if (!provider.id.startsWith(prefix)) return false
    return !provider.id.slice(prefix.length).includes('/')
  })
}

function secretFolderPaths(secrets: SecretMetadata[]): string[] {
  return secrets.flatMap((secret) => {
    const segments = secret.path.split('/').slice(0, -1)
    return segments.map((_, index) => segments.slice(0, index + 1).join('/'))
  })
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
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
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

function AuthRequiredConnectionItem({
  connection,
  onDismiss,
}: {
  connection: PendingAuthorization
  onDismiss: () => void
}) {
  const connectionName =
    connection.connection_id.split('/').at(-1) ?? connection.connection_id
  const expiresAt = new Date(connection.expires_at).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })

  return (
    <Item variant="outline">
      <ItemMedia variant="icon">
        <Link2Icon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          {connectionName}
          <Badge variant="outline">{connection.provider}</Badge>
          <Badge variant="secondary">Auth required</Badge>
        </ItemTitle>
        <ItemDescription>
          Authorization link expires at {expiresAt} · {connection.connection_id}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button asChild size="sm">
          <a href={connection.authorize_url}>
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

function ApiKeyItem({
  secret,
  deleting,
  onDelete,
}: {
  secret: SecretMetadata
  deleting: boolean
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
          <Badge variant="outline">API key</Badge>
        </ItemTitle>
        <ItemDescription>
          Encrypted in the Hookfish vault · {secret.path}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="destructive" disabled={deleting}>
              {deleting ? <Spinner /> : null}
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogMedia>
                <ShieldCheckIcon />
              </AlertDialogMedia>
              <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes the encrypted API key from the vault.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={onDelete}>
                Delete key
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </ItemActions>
    </Item>
  )
}

function ProviderItem({
  provider,
  deleting,
  onDelete,
}: {
  provider: ManagedProvider
  deleting: boolean
  onDelete: () => void
}) {
  const name = provider.id.split('/').at(-1) ?? provider.id

  return (
    <Item variant="outline">
      <ItemMedia variant="icon">
        <Settings2Icon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          {name}
          <Badge variant="outline">Provider</Badge>
          {!provider.enabled ? (
            <Badge variant="secondary">Disabled</Badge>
          ) : null}
        </ItemTitle>
        <ItemDescription>
          {provider.label !== name ? `${provider.label} · ` : ''}
          {provider.template ? `${provider.template} · ` : ''}
          {provider.id}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="destructive" disabled={deleting}>
              {deleting ? <Spinner /> : null}
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogMedia>
                <ShieldCheckIcon />
              </AlertDialogMedia>
              <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes the provider configuration. Disconnect
                any connections that use it first.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={onDelete}>
                Delete provider
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
          <Skeleton className="h-8 w-20" />
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
                    <button
                      type="button"
                      className="min-h-11 md:min-h-0"
                      onClick={() => onNavigate(path)}
                    >
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
  const normalizedName = name.trim()
  const error = normalizedName
    ? validateConnectionName(normalizedName)
    : undefined
  const path = joinConnectionPath(currentPath, normalizedName)
  const exists = normalizedName ? folders.includes(path) : false

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!normalizedName || error || exists) return
    onAdd(addLocalFolder(folders, currentPath, normalizedName))
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form className="grid gap-8" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add folder</DialogTitle>
            <DialogDescription>
              Create an empty folder in {currentPath || 'Connections'}. Folder
              structure is saved in this browser.
            </DialogDescription>
          </DialogHeader>
          <Field data-invalid={Boolean(error || exists)}>
            <FieldLabel htmlFor="folder-name">Folder name</FieldLabel>
            <Input
              id="folder-name"
              value={name}
              autoComplete="off"
              name="folder-name"
              required
              pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,63}"
              spellCheck={false}
              placeholder="production…"
              aria-invalid={Boolean(error || exists)}
              onChange={(event) => setName(event.target.value)}
            />
            <FieldDescription>
              Location: <code>{path || currentPath || 'Connections'}</code>
            </FieldDescription>
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
            <Button type="submit">
              <FolderPlusIcon />
              Add folder
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ProviderCombobox({
  id,
  value,
  configuredOnly = false,
  allowEmpty = false,
  placeholder = 'Search providers…',
  ariaLabel,
  className,
  onValueChange,
}: {
  id: string
  value: string
  configuredOnly?: boolean
  allowEmpty?: boolean
  placeholder?: string
  ariaLabel?: string
  className?: string
  onValueChange: (providerId: string, providerLabel?: string) => void
}) {
  const [inputValue, setInputValue] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null,
  )
  const providerLabels = useRef(new Map<string, string>())
  const selectedProviderId = useRef(value)
  const initialValueDisplayed = useRef(false)
  selectedProviderId.current = value
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search), 200)
    return () => window.clearTimeout(timeout)
  }, [search])
  useEffect(() => {
    setPortalContainer(
      document.getElementById(id)?.closest<HTMLElement>('[role="dialog"]') ??
        null,
    )
  }, [id])
  const providersQuery = hookfish.useProviderSearch(
    {
      limit: PROVIDER_SEARCH_LIMIT,
      ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
    },
    { placeholderData: (previous) => previous },
  )
  const providers = providersQuery.data?.providers ?? []
  for (const provider of providers) {
    providerLabels.current.set(provider.id, provider.label)
  }
  const providersById = new Map(
    providers.map((provider) => [provider.id, provider]),
  )
  const providerIds = providers.map((provider) => provider.id)
  useEffect(() => {
    if (!value || initialValueDisplayed.current) return
    const label = providerLabels.current.get(value)
    if (!label) return
    setInputValue(label)
    initialValueDisplayed.current = true
  }, [providers, value])

  return (
    <Combobox
      items={providerIds}
      defaultValue={value || null}
      inputValue={inputValue}
      filter={null}
      itemToStringLabel={(providerId: string) =>
        providerLabels.current.get(providerId) ?? providerId
      }
      itemToStringValue={(providerId: string) => providerId}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setSearch('')
        } else {
          window.setTimeout(() => {
            const selectedId = selectedProviderId.current
            setInputValue(
              selectedId
                ? (providerLabels.current.get(selectedId) ?? selectedId)
                : '',
            )
          })
        }
      }}
      onInputValueChange={(nextInputValue) => {
        setInputValue(nextInputValue)
        setSearch(nextInputValue)
      }}
      onValueChange={(providerId: string | null) => {
        if (providerId && !providersById.has(providerId)) return
        selectedProviderId.current = providerId ?? ''
        setInputValue(
          providerId
            ? (providerLabels.current.get(providerId) ?? providerId)
            : '',
        )
        onValueChange(
          providerId ?? '',
          providerId ? providerLabels.current.get(providerId) : undefined,
        )
      }}
    >
      <ComboboxInput
        id={id}
        aria-label={ariaLabel}
        className={className ?? 'w-full'}
        placeholder={placeholder}
        showClear={allowEmpty}
      />
      <ComboboxContent container={portalContainer ?? undefined}>
        <ComboboxEmpty>
          {providersQuery.isFetching
            ? 'Loading providers…'
            : providersQuery.isError
              ? 'Could not load providers.'
              : 'No providers found.'}
        </ComboboxEmpty>
        <ComboboxList>
          <ComboboxCollection>
            {(providerId: string, index) => {
              const provider = providersById.get(providerId)
              if (!provider) return null
              return (
                <ComboboxItem
                  key={provider.id}
                  value={provider.id}
                  index={index}
                  disabled={configuredOnly && !provider.configured}
                >
                  <span className="grid min-w-0">
                    <span className="truncate">{provider.label}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {provider.kind === 'mcp'
                        ? 'MCP'
                        : `${provider.label} OAuth`}{' '}
                      · {provider.id}
                      {!configuredOnly && !provider.configured
                        ? ' · Not configured'
                        : ''}
                    </span>
                  </span>
                </ComboboxItem>
              )
            }}
          </ComboboxCollection>
        </ComboboxList>
        {providers.length === PROVIDER_SEARCH_LIMIT ? (
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">
            Showing the first {PROVIDER_SEARCH_LIMIT} matches. Type to narrow
            the results.
          </p>
        ) : null}
      </ComboboxContent>
    </Combobox>
  )
}

function AddConnectionDialog({
  open,
  currentPath,
  existingSecretPaths,
  pendingConnectionIds,
  managementToken,
  authorizeMutation,
  secretMutation,
  onOpenChange,
}: {
  open: boolean
  currentPath: string
  existingSecretPaths: string[]
  pendingConnectionIds: string[]
  managementToken: string
  authorizeMutation: AuthorizeMutation
  secretMutation: ReturnType<
    typeof useMutation<SecretMetadata, Error, { path: string; value: string }>
  >
  onOpenChange: (open: boolean) => void
}) {
  const [kind, setKind] = useState<ConnectionKind>('oauth')
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [debouncedConnectionId, setDebouncedConnectionId] = useState('')
  const [value, setValue] = useState('')
  const [providerId, setProviderId] = useState('')
  const [providerLabel, setProviderLabel] = useState('')
  const normalizedSlug = slug.trim()
  const connectionId = joinConnectionPath(currentPath, normalizedSlug)
  const slugFormatError = normalizedSlug
    ? validateConnectionSlug(normalizedSlug)
    : undefined
  useEffect(() => {
    if (!open || !normalizedSlug || slugFormatError) {
      setDebouncedConnectionId('')
      return
    }
    const timeout = window.setTimeout(
      () => setDebouncedConnectionId(connectionId),
      250,
    )
    return () => window.clearTimeout(timeout)
  }, [connectionId, normalizedSlug, open, slugFormatError])
  const availabilityQuery = hookfish.useConnection(debouncedConnectionId, {
    enabled: Boolean(debouncedConnectionId),
    retry: false,
  })
  const secretTaken = existingSecretPaths.includes(connectionId)
  const authorizationPending = pendingConnectionIds.includes(connectionId)
  const checkingAvailability = Boolean(
    normalizedSlug &&
      !slugFormatError &&
      (!debouncedConnectionId ||
        debouncedConnectionId !== connectionId ||
        availabilityQuery.isFetching),
  )
  const connectionTaken =
    secretTaken ||
    authorizationPending ||
    (debouncedConnectionId === connectionId && availabilityQuery.isSuccess)
  const availabilityError =
    debouncedConnectionId === connectionId &&
    availabilityQuery.isError &&
    availabilityQuery.error.status !== 404
      ? 'Could not check whether this connection ID is available.'
      : undefined
  const idError = slugFormatError
    ? slugFormatError
    : connectionTaken
      ? 'This connection ID is already taken.'
      : availabilityError
  const idAvailable = Boolean(
    normalizedSlug &&
      !idError &&
      !checkingAvailability &&
      debouncedConnectionId === connectionId &&
      availabilityQuery.isError &&
      availabilityQuery.error.status === 404,
  )
  const showConnectionIdentity = kind === 'api-key' || Boolean(providerId)
  const apiKeyError =
    kind === 'api-key' && !managementToken
      ? 'Enter a broker access token above to store encrypted API keys.'
      : undefined

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim() || !idAvailable) return

    if (kind === 'api-key') {
      if (!managementToken || !value) return
      secretMutation.mutate(
        { path: connectionId, value },
        { onSuccess: () => onOpenChange(false) },
      )
      return
    }

    if (!providerId) return
    const input: AuthorizeConnectionInput = {
      provider: providerId,
      return_to: window.location.href,
      connection_id: connectionId,
    }
    authorizeMutation.mutate(input)
  }

  const pending = authorizeMutation.isPending || secretMutation.isPending
  const submitDisabled =
    pending ||
    !name.trim() ||
    !idAvailable ||
    (kind === 'oauth' ? !providerId : !managementToken)

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => !pending && onOpenChange(nextOpen)}
    >
      <DialogContent>
        <form className="grid gap-8" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add connection</DialogTitle>
            <DialogDescription>
              Add the connection directly to {currentPath || 'Connections'}.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="connection-kind">Connection type</FieldLabel>
              <Select
                value={kind}
                onValueChange={(value) => {
                  if (value !== 'oauth' && value !== 'api-key') return
                  setKind(value)
                  if (nameEdited) return

                  const suggestedName =
                    value === 'api-key' ? 'API key' : providerLabel
                  setName(suggestedName)
                  if (!slugEdited) {
                    setSlug(
                      value === 'oauth' && providerId
                        ? connectionSlug(providerLabel || providerId)
                        : suggestedName
                          ? connectionSlug(suggestedName)
                          : '',
                    )
                  }
                }}
              >
                <SelectTrigger id="connection-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="oauth">OAuth / MCP account</SelectItem>
                  <SelectItem value="api-key">API key</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {kind === 'oauth' ? (
              <Field>
                <FieldLabel htmlFor="connection-provider">Provider</FieldLabel>
                <ProviderCombobox
                  id="connection-provider"
                  value={providerId}
                  configuredOnly
                  onValueChange={(nextProviderId, nextProviderLabel) => {
                    setProviderId(nextProviderId)
                    setProviderLabel(nextProviderLabel ?? '')
                    if (!nextProviderId || nameEdited) return

                    const suggestedName = nextProviderLabel ?? nextProviderId
                    setName(suggestedName)
                    if (!slugEdited) setSlug(nextProviderId)
                  }}
                />
              </Field>
            ) : null}

            {showConnectionIdentity ? (
              <>
                <Field>
                  <FieldLabel htmlFor="connection-name">
                    Connection name
                  </FieldLabel>
                  <Input
                    id="connection-name"
                    value={name}
                    name="connection-name"
                    required
                    spellCheck={false}
                    placeholder={
                      kind === 'api-key'
                        ? 'Production API key…'
                        : 'Notion production…'
                    }
                    autoComplete="off"
                    onChange={(event) => {
                      const nextName = event.target.value
                      const currentGeneratedSlug = connectionSlug(name)
                      setName(nextName)
                      setNameEdited(true)
                      if (
                        !slugEdited ||
                        normalizedSlug === currentGeneratedSlug
                      ) {
                        setSlug(connectionSlug(nextName))
                        setSlugEdited(false)
                      }
                    }}
                  />
                  <FieldDescription>
                    Used to generate the connection ID below.
                  </FieldDescription>
                </Field>

                <Field data-invalid={Boolean(idError)}>
                  <div className="flex items-center justify-between gap-4">
                    <FieldLabel htmlFor="connection-id">
                      Connection ID
                    </FieldLabel>
                    {normalizedSlug && !slugFormatError ? (
                      <span
                        role="status"
                        aria-live="polite"
                        className={
                          connectionTaken || availabilityError
                            ? 'flex items-center gap-2 text-xs tracking-wide text-destructive uppercase'
                            : 'flex items-center gap-2 text-xs tracking-wide text-primary uppercase'
                        }
                      >
                        {checkingAvailability ? (
                          <Spinner className="size-3.5" />
                        ) : connectionTaken || availabilityError ? (
                          <CircleXIcon className="size-3.5" />
                        ) : (
                          <CircleCheckIcon className="size-3.5" />
                        )}
                        {checkingAvailability
                          ? 'Checking'
                          : connectionTaken
                            ? 'Taken'
                            : availabilityError
                              ? 'Unavailable'
                              : 'Available'}
                      </span>
                    ) : null}
                  </div>
                  <Input
                    id="connection-id"
                    value={slug}
                    name="connection-id"
                    required
                    maxLength={64}
                    pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={
                      kind === 'api-key'
                        ? 'production-api-key'
                        : 'notion-production'
                    }
                    aria-invalid={Boolean(idError)}
                    onChange={(event) => {
                      setSlug(event.target.value)
                      setSlugEdited(true)
                    }}
                  />
                  <FieldDescription>
                    Full ID: <code>{connectionId || 'connection-id'}</code>
                  </FieldDescription>
                  <FieldError>{idError}</FieldError>
                </Field>
              </>
            ) : null}

            {kind === 'api-key' ? (
              <Field data-invalid={Boolean(apiKeyError)}>
                <FieldLabel htmlFor="api-key-value">API key</FieldLabel>
                <Input
                  id="api-key-value"
                  type="password"
                  value={value}
                  name="api-key-value"
                  required
                  autoComplete="off"
                  placeholder="Paste the secret value…"
                  aria-invalid={Boolean(apiKeyError)}
                  onChange={(event) => setValue(event.target.value)}
                />
                <FieldDescription>
                  The value is encrypted at rest and cannot be viewed here after
                  saving.
                </FieldDescription>
                <FieldError>{apiKeyError}</FieldError>
              </Field>
            ) : null}
          </FieldGroup>

          {authorizeMutation.isError || secretMutation.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Could not add connection</AlertTitle>
              <AlertDescription>
                {authorizeMutation.error?.message ??
                  secretMutation.error?.message}
              </AlertDescription>
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
            <Button type="submit" disabled={submitDisabled}>
              {pending ? <Spinner /> : <PlusIcon />}
              {pending ? 'Saving…' : 'Add connection'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
  const [providerFilter, setProviderFilter] = useState(ALL_PROVIDERS)
  const [view, setView] = useState<ConnectionView>('tree')
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [pendingAuthorizations, setPendingAuthorizations] = useState<
    PendingAuthorization[]
  >([])
  const activePendingAuthorizations = pendingAuthorizations.filter(
    (authorization) => Date.parse(authorization.expires_at) > Date.now(),
  )
  const [localFolders, setLocalFolders] = useState<string[]>(() =>
    typeof window === 'undefined' ? [] : readLocalFolders(window.localStorage),
  )
  const connectionsQuery = hookfish.useConnections(
    {
      ...(view === 'tree' && currentPath
        ? { connection_id_prefix: currentPath }
        : {}),
      ...(providerFilter === ALL_PROVIDERS ? {} : { provider: providerFilter }),
    },
    {
      refetchInterval: (query) =>
        activePendingAuthorizations.some(
          (authorization) =>
            !query.state.data?.connections.some(
              (connection) =>
                connection.connection_id === authorization.connection_id,
            ),
        )
          ? 3_000
          : false,
    },
  )
  const secretsQuery = useQuery({
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
  const managedProvidersQuery = useQuery({
    queryKey: ['management', 'providers', managementToken],
    queryFn: () => listManagedProviders(managementToken),
    enabled: Boolean(managementToken),
  })
  const authorizeMutation = hookfish.useAuthorizeConnection({
    onSuccess(data, input) {
      setPendingAuthorizations((current) => [
        ...current.filter(
          (authorization) => authorization.connection_id !== data.connection_id,
        ),
        { ...data, status: 'auth_required', provider: input.provider },
      ])
      setAddDialogOpen(false)
    },
  })
  const disconnectMutation = hookfish.useDisconnectConnection()
  const secretMutation = useMutation({
    mutationFn: ({ path, value }: { path: string; value: string }) =>
      storeSecret(managementToken, path, value),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['management', 'secrets'] }),
  })
  const deleteSecretMutation = useMutation({
    mutationFn: (path: string) => deleteSecret(managementToken, path),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['management', 'secrets'] }),
  })
  const deleteProviderMutation = useMutation({
    mutationFn: (providerId: string) =>
      deleteManagedProvider(managementToken, providerId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['management', 'providers'],
        }),
        queryClient.invalidateQueries({ queryKey: hookfish.keys.providers() }),
      ])
    },
  })

  useEffect(() => {
    const connectedIds = new Set(
      (connectionsQuery.data?.connections ?? []).map(
        (connection) => connection.connection_id,
      ),
    )
    if (connectedIds.size === 0) return

    setPendingAuthorizations((current) => {
      if (
        !current.some((authorization) =>
          connectedIds.has(authorization.connection_id),
        )
      ) {
        return current
      }
      return current.filter(
        (authorization) => !connectedIds.has(authorization.connection_id),
      )
    })
  }, [connectionsQuery.data?.connections])

  useEffect(() => {
    function refreshConnections() {
      void queryClient.invalidateQueries({
        queryKey: hookfish.keys.connectionsRoot(),
      })
      if (managementToken) {
        void queryClient.invalidateQueries({
          queryKey: ['management', 'secrets'],
        })
        void queryClient.invalidateQueries({
          queryKey: ['management', 'providers'],
        })
      }
    }

    refreshConnections()
    window.addEventListener('pageshow', refreshConnections)
    window.addEventListener('focus', refreshConnections)
    return () => {
      window.removeEventListener('pageshow', refreshConnections)
      window.removeEventListener('focus', refreshConnections)
    }
  }, [managementToken, queryClient])

  const secretFolders = secretFolderPaths(secretsQuery.data ?? [])
  const dynamicProviders = useMemo(
    () =>
      (managedProvidersQuery.data ?? [])
        .filter((provider) => provider.source === 'dynamic')
        .sort((left, right) => left.id.localeCompare(right.id)),
    [managedProvidersQuery.data],
  )
  const directory = useMemo(
    () =>
      connectionDirectory(
        connectionsQuery.data?.connections ?? [],
        currentPath,
        [...localFolders, ...secretFolders],
        [
          ...(secretsQuery.data ?? []).map((secret) => secret.path),
          ...dynamicProviders.map((provider) => provider.id),
        ],
      ),
    [
      connectionsQuery.data?.connections,
      currentPath,
      localFolders,
      secretFolders,
      secretsQuery.data,
      dynamicProviders,
    ],
  )
  const visibleSecrets =
    view === 'tree'
      ? directSecrets(secretsQuery.data ?? [], currentPath)
      : (secretsQuery.data ?? [])
  const visibleProviders =
    view === 'tree'
      ? directProviders(dynamicProviders, currentPath)
      : dynamicProviders
  const allConnections = useMemo(
    () =>
      [...(connectionsQuery.data?.connections ?? [])].sort((left, right) =>
        left.connection_id.localeCompare(right.connection_id),
      ),
    [connectionsQuery.data?.connections],
  )
  const visiblePendingAuthorizations = activePendingAuthorizations.filter(
    (authorization) => {
      if (
        providerFilter !== ALL_PROVIDERS &&
        authorization.provider !== providerFilter
      ) {
        return false
      }
      if (view === 'all') return true

      const prefix = currentPath ? `${currentPath}/` : ''
      const remainder = authorization.connection_id.slice(prefix.length)
      return (
        authorization.connection_id.startsWith(prefix) &&
        Boolean(remainder) &&
        !remainder.includes('/')
      )
    },
  )
  const isEmpty =
    !connectionsQuery.isPending &&
    !secretsQuery.isPending &&
    !managedProvidersQuery.isPending &&
    !connectionsQuery.isError &&
    !secretsQuery.isError &&
    !managedProvidersQuery.isError &&
    (view === 'all'
      ? allConnections.length === 0 &&
        visiblePendingAuthorizations.length === 0 &&
        visibleSecrets.length === 0 &&
        visibleProviders.length === 0
      : directory.folders.length === 0 &&
        directory.connections.length === 0 &&
        visiblePendingAuthorizations.length === 0 &&
        visibleSecrets.length === 0 &&
        visibleProviders.length === 0)
  const addConnectionPath = view === 'tree' ? currentPath : ''

  function updateFolders(folders: string[]) {
    setLocalFolders(folders)
    window.localStorage.setItem(LOCAL_FOLDERS_KEY, JSON.stringify(folders))
  }

  function dismissAuthorization(connectionId: string) {
    setPendingAuthorizations((current) =>
      current.filter(
        (authorization) => authorization.connection_id !== connectionId,
      ),
    )
  }

  return (
    <section
      aria-labelledby="connections-heading"
      className="grid h-full min-h-0 min-w-0 overflow-hidden"
    >
      <Card className="h-full min-h-0 min-w-0 gap-0 rounded-none border-x-0 border-b-0 border-t-2 border-t-primary py-0">
        <CardContent className="grid min-h-0 min-w-0 flex-1 content-start gap-8 overflow-x-hidden overflow-y-auto overscroll-y-contain px-4 pb-8 md:px-8">
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
                  <Button
                    variant="outline"
                    onClick={() => setFolderDialogOpen(true)}
                  >
                    <FolderPlusIcon />
                    Add folder
                  </Button>
                ) : null}
                <OAuthConfigDialog
                  managementToken={managementToken}
                  currentPath={addConnectionPath}
                />
                <Button onClick={() => setAddDialogOpen(true)}>
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
              <ProviderCombobox
                id="provider-filter"
                className="w-52"
                value={providerFilter === ALL_PROVIDERS ? '' : providerFilter}
                allowEmpty
                placeholder="All providers"
                ariaLabel="Filter by provider"
                onValueChange={(providerId) =>
                  setProviderFilter(providerId || ALL_PROVIDERS)
                }
              />
            </div>
          </div>

          {connectionsQuery.isPending ||
          secretsQuery.isPending ||
          managedProvidersQuery.isPending ? (
            <LoadingItems />
          ) : null}

          {connectionsQuery.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Could not load connections</AlertTitle>
              <AlertDescription>
                {connectionsQuery.error.message}
              </AlertDescription>
            </Alert>
          ) : null}

          {secretsQuery.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Could not load API keys</AlertTitle>
              <AlertDescription>{secretsQuery.error.message}</AlertDescription>
            </Alert>
          ) : null}

          {managedProvidersQuery.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Could not load providers</AlertTitle>
              <AlertDescription>
                {managedProvidersQuery.error.message}
              </AlertDescription>
            </Alert>
          ) : null}

          {isEmpty ? (
            <Empty className="border py-16">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FolderIcon />
                </EmptyMedia>
                <EmptyTitle>
                  {view === 'tree' ? 'This folder is empty' : 'No connections'}
                </EmptyTitle>
                <EmptyDescription>
                  {view === 'tree' && currentPath
                    ? 'This folder is stored only in this browser. It won’t appear in the Hookfish API until you add a resource.'
                    : view === 'tree'
                      ? 'Add a folder, provider, connection, or API key here.'
                      : 'Create a provider, OAuth connection, MCP connection, or API key.'}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={() => setAddDialogOpen(true)}>
                  <PlusIcon />
                  Add connection
                </Button>
              </EmptyContent>
            </Empty>
          ) : null}

          {view === 'tree' &&
          (directory.folders.length ||
            directory.connections.length ||
            visiblePendingAuthorizations.length ||
            visibleSecrets.length ||
            visibleProviders.length) ? (
            <ItemGroup>
              {directory.folders.map((folder) => (
                <Item asChild variant="outline" key={folder.path}>
                  <button type="button" onClick={() => onNavigate(folder.path)}>
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
              {visiblePendingAuthorizations.map((authorization) => (
                <AuthRequiredConnectionItem
                  key={authorization.connection_id}
                  connection={authorization}
                  onDismiss={() =>
                    dismissAuthorization(authorization.connection_id)
                  }
                />
              ))}
              {visibleSecrets.map((secret) => (
                <ApiKeyItem
                  key={secret.path}
                  secret={secret}
                  deleting={
                    deleteSecretMutation.isPending &&
                    deleteSecretMutation.variables === secret.path
                  }
                  onDelete={() => deleteSecretMutation.mutate(secret.path)}
                />
              ))}
              {visibleProviders.map((provider) => (
                <ProviderItem
                  key={provider.id}
                  provider={provider}
                  deleting={
                    deleteProviderMutation.isPending &&
                    deleteProviderMutation.variables === provider.id
                  }
                  onDelete={() => deleteProviderMutation.mutate(provider.id)}
                />
              ))}
            </ItemGroup>
          ) : null}

          {view === 'all' &&
          (allConnections.length ||
            visiblePendingAuthorizations.length ||
            visibleSecrets.length ||
            visibleProviders.length) ? (
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
              {visiblePendingAuthorizations.map((authorization) => (
                <AuthRequiredConnectionItem
                  key={authorization.connection_id}
                  connection={authorization}
                  onDismiss={() =>
                    dismissAuthorization(authorization.connection_id)
                  }
                />
              ))}
              {visibleSecrets.map((secret) => (
                <ApiKeyItem
                  key={secret.path}
                  secret={secret}
                  deleting={
                    deleteSecretMutation.isPending &&
                    deleteSecretMutation.variables === secret.path
                  }
                  onDelete={() => deleteSecretMutation.mutate(secret.path)}
                />
              ))}
              {visibleProviders.map((provider) => (
                <ProviderItem
                  key={provider.id}
                  provider={provider}
                  deleting={
                    deleteProviderMutation.isPending &&
                    deleteProviderMutation.variables === provider.id
                  }
                  onDelete={() => deleteProviderMutation.mutate(provider.id)}
                />
              ))}
            </ItemGroup>
          ) : null}

          {disconnectMutation.isError ||
          deleteSecretMutation.isError ||
          deleteProviderMutation.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Could not remove item</AlertTitle>
              <AlertDescription>
                {disconnectMutation.error?.message ??
                  deleteSecretMutation.error?.message ??
                  deleteProviderMutation.error?.message}
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <AddFolderDialog
        key={`folder:${folderDialogOpen ? 'open' : 'closed'}:${currentPath}`}
        open={folderDialogOpen}
        currentPath={currentPath}
        folders={localFolders}
        onAdd={updateFolders}
        onOpenChange={setFolderDialogOpen}
      />
      <AddConnectionDialog
        key={`connection:${addDialogOpen ? 'open' : 'closed'}:${addConnectionPath}`}
        open={addDialogOpen}
        currentPath={addConnectionPath}
        existingSecretPaths={(secretsQuery.data ?? []).map(
          (secret) => secret.path,
        )}
        pendingConnectionIds={activePendingAuthorizations.map(
          (authorization) => authorization.connection_id,
        )}
        managementToken={managementToken}
        authorizeMutation={authorizeMutation}
        secretMutation={secretMutation}
        onOpenChange={setAddDialogOpen}
      />
    </section>
  )
}
