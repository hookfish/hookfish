import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  CircleXIcon,
  CopyIcon,
  NetworkIcon,
  KeyRoundIcon,
  PlusIcon,
  Settings2Icon,
} from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import {
  listManagedProviders,
  storeManagedProvider,
  type StoreProviderInput,
} from '@/lib/management-api'
import { hookfish } from '@/lib/hookfish'
import { defaultOAuthConfigId, oauthRedirectUri } from '@/lib/oauth-config'

const PROVIDER_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function BrokerAccess({
  token,
  onTokenChange,
}: {
  token: string
  onTokenChange: (token: string) => void
}) {
  const [draft, setDraft] = useState(token)
  const [open, setOpen] = useState(false)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextToken = draft.trim()
    if (!nextToken) return
    onTokenChange(nextToken)
    setOpen(false)
  }

  function clearToken() {
    setDraft('')
    onTokenChange('')
    setOpen(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setDraft(token)
        setOpen(nextOpen)
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant={token ? 'secondary' : 'outline'}
          size="sm"
          aria-label="Broker access"
        >
          <KeyRoundIcon />
          <span className="hidden sm:inline">
            {token ? 'Access active' : 'Broker access'}
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form className="grid gap-8" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Broker access</DialogTitle>
            <DialogDescription>
              Enter a root or scoped token to manage encrypted API keys and
              custom OAuth configurations. It is kept for this browser session.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="broker-token">Broker access token</FieldLabel>
            <Input
              id="broker-token"
              type="password"
              value={draft}
              name="broker-token"
              required
              autoComplete="off"
              placeholder="Enter a root or scoped token…"
              onChange={(event) => setDraft(event.target.value)}
            />
          </Field>
          <DialogFooter>
            {token ? (
              <Button type="button" variant="outline" onClick={clearToken}>
                Clear access
              </Button>
            ) : null}
            <Button type="submit">
              <KeyRoundIcon />
              {token ? 'Update access' : 'Enable access'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function BrokerAccessPrompt({
  onTokenChange,
}: {
  onTokenChange: (token: string) => void
}) {
  const [draft, setDraft] = useState('')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const token = draft.trim()
    if (token) onTokenChange(token)
  }

  return (
    <section className="grid h-full place-items-center p-4 md:p-8">
      <div className="grid w-full max-w-xl gap-8 border-t-2 border-t-primary bg-card p-8">
        <div>
          <p className="text-xs tracking-widest text-foreground/40 uppercase">
            Connections
          </p>
          <h1 className="mt-2 text-3xl font-light tracking-tight text-balance">
            Broker API key required
          </h1>
          <p className="mt-4 max-w-[52ch] text-sm leading-relaxed text-foreground/70">
            Enter a root or scoped broker API key to load connections. The key
            stays in this browser session.
          </p>
        </div>
        <form
          className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end"
          onSubmit={handleSubmit}
        >
          <Field>
            <FieldLabel htmlFor="connections-broker-token">
              Broker API key
            </FieldLabel>
            <Input
              id="connections-broker-token"
              type="password"
              name="broker-token"
              value={draft}
              required
              autoComplete="off"
              placeholder="Enter your broker API key…"
              onChange={(event) => setDraft(event.target.value)}
            />
          </Field>
          <Button type="submit">
            <KeyRoundIcon />
            Open connections
          </Button>
        </form>
      </div>
    </section>
  )
}

function AddProviderDialog({
  open,
  templates,
  existingIds,
  callbackUrls,
  pending,
  error,
  onSubmit,
  onOpenChange,
}: {
  open: boolean
  templates: Array<{ id: string; label: string }>
  existingIds: string[]
  callbackUrls: Record<string, string>
  pending: boolean
  error?: Error | null
  onSubmit: (input: StoreProviderInput) => void
  onOpenChange: (open: boolean) => void
}) {
  const initialTemplate = templates[0]?.id ?? ''
  const [id, setId] = useState(() =>
    defaultOAuthConfigId(initialTemplate, existingIds),
  )
  const [idEdited, setIdEdited] = useState(false)
  const [label, setLabel] = useState('')
  const [template, setTemplate] = useState(initialTemplate)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [resourceUrl, setResourceUrl] = useState('')
  const [scopes, setScopes] = useState('')
  const [optionalConfigOpen, setOptionalConfigOpen] = useState(false)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>(
    'idle',
  )
  const normalizedId = id.trim().toLowerCase()
  const isMcp = template === 'mcp'
  const redirectUri = oauthRedirectUri(callbackUrls[template], normalizedId)
  const idTaken = existingIds.includes(normalizedId)
  const idFormatError =
    normalizedId && !PROVIDER_ID_PATTERN.test(normalizedId)
      ? 'Use lowercase letters, numbers, and single hyphens.'
      : undefined
  const idError = idFormatError
    ? idFormatError
    : idTaken
      ? 'This configuration ID is already taken.'
      : undefined
  const idAvailable = Boolean(normalizedId && !idError)
  let resourceUrlError: string | undefined
  if (isMcp && resourceUrl.trim()) {
    try {
      const url = new URL(resourceUrl.trim())
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        resourceUrlError = 'Use an HTTP or HTTPS MCP server URL.'
      }
    } catch {
      resourceUrlError = 'Enter an absolute MCP server URL.'
    }
  }
  const clientCredentialError =
    isMcp && clientSecret && !clientId.trim()
      ? 'Enter the client ID that belongs to this secret.'
      : undefined
  const providerFieldsValid = isMcp
    ? Boolean(
        label.trim() &&
          resourceUrl.trim() &&
          !resourceUrlError &&
          !clientCredentialError,
      )
    : Boolean(clientId.trim() && clientSecret)

  function handleTemplateChange(nextTemplate: string) {
    const currentDefault = defaultOAuthConfigId(template, existingIds)
    setTemplate(nextTemplate)
    if (!idEdited || id === currentDefault) {
      setId(defaultOAuthConfigId(nextTemplate, existingIds))
      setIdEdited(false)
    }
    setCopyStatus('idle')
  }

  async function copyRedirectUri() {
    if (!redirectUri) return
    try {
      await navigator.clipboard.writeText(redirectUri)
      setCopyStatus('copied')
    } catch {
      setCopyStatus('error')
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (
      !normalizedId ||
      idError ||
      !template ||
      (!isMcp && (!clientId.trim() || !clientSecret)) ||
      (isMcp &&
        (!label.trim() ||
          !resourceUrl.trim() ||
          resourceUrlError ||
          clientCredentialError))
    ) {
      return
    }
    const base = {
      id: normalizedId,
      template,
      ...(label.trim() ? { label: label.trim() } : {}),
    }
    if (isMcp) {
      onSubmit({
        ...base,
        type: 'mcp',
        resourceUrl: resourceUrl.trim(),
        scopes: scopes
          .split(/[\s,]+/)
          .map((scope) => scope.trim())
          .filter(Boolean),
        ...(clientId.trim() ? { clientId: clientId.trim() } : {}),
        ...(clientSecret ? { clientSecret } : {}),
      })
      return
    }
    onSubmit({
      ...base,
      type: 'oauth',
      clientId: clientId.trim(),
      clientSecret,
    })
  }

  const displayNameField = (
    <Field>
      <FieldLabel htmlFor="provider-label">Display name</FieldLabel>
      <Input
        id="provider-label"
        value={label}
        name="provider-label"
        required={isMcp}
        autoComplete="off"
        placeholder={isMcp ? 'Notion MCP…' : 'GitHub production…'}
        onChange={(event) => setLabel(event.target.value)}
      />
      {isMcp ? (
        <FieldDescription>
          Used to distinguish this server anywhere providers are listed.
        </FieldDescription>
      ) : null}
    </Field>
  )
  const clientCredentialFields = (
    <>
      <Field data-invalid={Boolean(clientCredentialError)}>
        <FieldLabel htmlFor="provider-client-id">
          Client ID {isMcp ? '(optional)' : ''}
        </FieldLabel>
        <Input
          id="provider-client-id"
          value={clientId}
          name="provider-client-id"
          required={!isMcp}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setClientId(event.target.value)}
        />
        {isMcp ? (
          <FieldDescription>
            Leave this empty to use automatic client registration. If it is
            unavailable, enter a pre-registered client ID.
          </FieldDescription>
        ) : null}
        <FieldError>{clientCredentialError}</FieldError>
      </Field>
      <Field>
        <FieldLabel htmlFor="provider-client-secret">
          Client secret {isMcp ? '(optional)' : ''}
        </FieldLabel>
        <Input
          id="provider-client-secret"
          type="password"
          value={clientSecret}
          name="provider-client-secret"
          required={!isMcp}
          autoComplete="off"
          onChange={(event) => setClientSecret(event.target.value)}
        />
        <FieldDescription>
          {isMcp
            ? 'Public MCP clients do not need a secret. When supplied, it is encrypted and write-only.'
            : 'The secret is encrypted and write-only after it is saved.'}
        </FieldDescription>
      </Field>
    </>
  )
  const redirectUriField = (
    <Field data-invalid={copyStatus === 'error'}>
      <FieldLabel htmlFor="provider-redirect-uri">Redirect URI</FieldLabel>
      <div className="flex gap-2">
        <Input
          id="provider-redirect-uri"
          className="min-w-0 font-mono text-xs"
          value={redirectUri}
          readOnly
          aria-describedby="provider-redirect-uri-description"
        />
        <Button
          type="button"
          size="icon"
          variant="outline"
          disabled={!redirectUri}
          aria-label={
            copyStatus === 'copied'
              ? 'Redirect URI copied'
              : 'Copy redirect URI'
          }
          onClick={copyRedirectUri}
        >
          {copyStatus === 'copied' ? <CheckIcon /> : <CopyIcon />}
        </Button>
      </div>
      <FieldDescription id="provider-redirect-uri-description">
        {isMcp
          ? 'Use this exact URI when pre-registering Hookfish with the MCP authorization server.'
          : 'Register this exact URI in the provider’s developer console.'}
      </FieldDescription>
      <FieldError>
        {copyStatus === 'error'
          ? 'Could not copy. Select the URI and copy it manually.'
          : undefined}
      </FieldError>
    </Field>
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => !pending && onOpenChange(nextOpen)}
    >
      <DialogContent className="sm:max-w-lg">
        <form className="grid gap-8" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add provider</DialogTitle>
            <DialogDescription>
              Configure an OAuth application or connect Hookfish to a remote MCP
              server.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="provider-template">Provider type</FieldLabel>
              <Select value={template} onValueChange={handleTemplateChange}>
                <SelectTrigger id="provider-template" className="w-full">
                  <SelectValue placeholder="Select a template" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((item) => (
                    <SelectItem value={item.id} key={item.id}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field data-invalid={Boolean(idError)}>
              <div className="flex items-center justify-between gap-4">
                <FieldLabel htmlFor="provider-id">Configuration ID</FieldLabel>
                {normalizedId && !idFormatError ? (
                  <span
                    role="status"
                    aria-live="polite"
                    className={
                      idTaken
                        ? 'flex items-center gap-2 text-xs tracking-wide text-destructive uppercase'
                        : 'flex items-center gap-2 text-xs tracking-wide text-primary uppercase'
                    }
                  >
                    {idTaken ? (
                      <CircleXIcon className="size-3.5" />
                    ) : (
                      <CircleCheckIcon className="size-3.5" />
                    )}
                    {idTaken ? 'Taken' : 'Available'}
                  </span>
                ) : null}
              </div>
              <Input
                id="provider-id"
                value={id}
                name="provider-id"
                required
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                autoComplete="off"
                spellCheck={false}
                placeholder="github-production…"
                aria-invalid={Boolean(idError)}
                onChange={(event) => {
                  setId(event.target.value)
                  setIdEdited(true)
                  setCopyStatus('idle')
                }}
              />
              <FieldDescription>
                Edit this ID to update the redirect URI below.
              </FieldDescription>
              <FieldError>{idError}</FieldError>
            </Field>
            {displayNameField}
            {isMcp ? (
              <Field data-invalid={Boolean(resourceUrlError)}>
                <FieldLabel htmlFor="provider-resource-url">
                  MCP server URL
                </FieldLabel>
                <Input
                  id="provider-resource-url"
                  type="url"
                  value={resourceUrl}
                  name="provider-resource-url"
                  required
                  autoComplete="url"
                  spellCheck={false}
                  placeholder="https://mcp.example.com/mcp…"
                  aria-invalid={Boolean(resourceUrlError)}
                  onChange={(event) => setResourceUrl(event.target.value)}
                />
                <FieldDescription>
                  Hookfish discovers the protected resource and authorization
                  server metadata from this endpoint.
                </FieldDescription>
                <FieldError>{resourceUrlError}</FieldError>
              </Field>
            ) : null}
            {isMcp ? (
              <Collapsible
                className="grid gap-3 border p-4"
                open={optionalConfigOpen}
                onOpenChange={setOptionalConfigOpen}
              >
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full justify-between px-0 hover:bg-transparent"
                  >
                    <span className="grid gap-1 text-left">
                      <span>Optional configuration</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        Scopes and pre-registered OAuth credentials
                      </span>
                    </span>
                    <ChevronDownIcon
                      className={`transition-transform ${optionalConfigOpen ? 'rotate-180' : ''}`}
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <FieldGroup className="pt-4">
                    <Field>
                      <FieldLabel htmlFor="provider-scopes">
                        OAuth scopes
                      </FieldLabel>
                      <Input
                        id="provider-scopes"
                        value={scopes}
                        name="provider-scopes"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="mcp:tools mcp:resources…"
                        onChange={(event) => setScopes(event.target.value)}
                      />
                      <FieldDescription>
                        Separate scopes with spaces or commas. When empty,
                        Hookfish uses the MCP server’s advertised scopes.
                      </FieldDescription>
                    </Field>
                    {clientCredentialFields}
                    {redirectUriField}
                  </FieldGroup>
                </CollapsibleContent>
              </Collapsible>
            ) : (
              <>
                {clientCredentialFields}
                {redirectUriField}
              </>
            )}
          </FieldGroup>

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Could not save provider</AlertTitle>
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
            <Button
              type="submit"
              disabled={
                pending ||
                templates.length === 0 ||
                !idAvailable ||
                !providerFieldsValid
              }
            >
              {pending ? <Spinner /> : isMcp ? <NetworkIcon /> : <PlusIcon />}
              {pending ? 'Saving…' : 'Save provider'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function OAuthConfigDialog({
  managementToken,
}: {
  managementToken: string
}) {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const managedProvidersQuery = useQuery({
    queryKey: ['management', 'providers', managementToken],
    queryFn: () => listManagedProviders(managementToken),
    enabled: false,
  })
  const publicProvidersQuery = hookfish.useProviderSearch({
    limit: 100,
    source: 'fixed',
  })
  const storeMutation = useMutation({
    async mutationFn(input: StoreProviderInput) {
      const providers = await listManagedProviders(managementToken)
      queryClient.setQueryData(
        ['management', 'providers', managementToken],
        providers,
      )
      if (providers.some((provider) => provider.id === input.id)) {
        throw new Error(
          `The configuration ID “${input.id}” was just taken. Choose another ID.`,
        )
      }
      return storeManagedProvider(managementToken, input)
    },
    async onSuccess() {
      setDialogOpen(false)
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['management', 'providers'],
        }),
        queryClient.invalidateQueries({ queryKey: hookfish.keys.providers() }),
      ])
    },
  })
  const templates = (managedProvidersQuery.data ?? [])
    .filter((provider) => provider.source === 'fixed')
    .map(({ id, label }) => ({ id, label }))
  const existingIds = (managedProvidersQuery.data ?? []).map(({ id }) => id)
  const callbackUrls = Object.fromEntries(
    (publicProvidersQuery.data?.providers ?? []).map((provider) => [
      provider.id,
      provider.callback_url,
    ]),
  )
  const loading =
    managedProvidersQuery.isFetching || publicProvidersQuery.isFetching

  async function openDialog() {
    storeMutation.reset()
    await managedProvidersQuery.refetch()
    setDialogOpen(true)
  }

  return (
    <>
      <Button
        variant="outline"
        disabled={!managementToken || loading}
        onClick={() => void openDialog()}
      >
        {loading ? <Spinner /> : <Settings2Icon />}
        Add provider
      </Button>
      <AddProviderDialog
        key={`${dialogOpen ? 'open' : 'closed'}:${templates.map(({ id }) => id).join(',')}`}
        open={dialogOpen}
        templates={templates}
        existingIds={existingIds}
        callbackUrls={callbackUrls}
        pending={storeMutation.isPending}
        error={
          managedProvidersQuery.error ??
          publicProvidersQuery.error ??
          storeMutation.error
        }
        onSubmit={(input) => storeMutation.mutate(input)}
        onOpenChange={(open) => {
          if (open) storeMutation.reset()
          setDialogOpen(open)
        }}
      />
    </>
  )
}
