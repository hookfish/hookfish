import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import {
  authorizeMcpServer,
  executeMcpTool,
  type InspectorSnapshot,
  inspectMcpServer,
  readMcpResource,
  renderMcpPrompt,
} from '../lib/inspector-functions'

const serverSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.url(),
  connectionId: z.string().optional(),
})
const serversSchema = z.array(serverSchema)
const jsonObjectSchema = z.record(z.string(), z.unknown())
const stringObjectSchema = z.record(z.string(), z.string())

type SavedServer = z.infer<typeof serverSchema>
type Snapshot = InspectorSnapshot
type InspectorTab = 'tools' | 'resources' | 'prompts' | 'server'

const storageKey = 'hookfish:mcp-servers'
const pendingAuthKey = 'hookfish:mcp-pending-auth'
const inspectorTabSchema = z.enum(['tools', 'resources', 'prompts', 'server'])
const tabs: Array<{ id: InspectorTab; label: string }> = [
  { id: 'tools', label: 'Tools' },
  { id: 'resources', label: 'Resources' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'server', label: 'Server' },
]

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The request failed.'
}

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function parseObject(value: string) {
  return jsonObjectSchema.parse(JSON.parse(value))
}

function parseStringObject(value: string) {
  return stringObjectSchema.parse(JSON.parse(value))
}

const omitSchemaValue = Symbol('omit-schema-value')

function schemaRecord(value: unknown) {
  const parsed = jsonObjectSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function localSchemaReference(root: unknown, reference: unknown) {
  if (typeof reference !== 'string' || !reference.startsWith('#/')) return null
  let value = root
  for (const segment of reference.slice(2).split('/')) {
    const record = schemaRecord(value)
    if (!record) return null
    const key = segment.replaceAll('~1', '/').replaceAll('~0', '~')
    value = record[key]
  }
  return value
}

function schemaType(schema: Record<string, unknown>) {
  if (typeof schema.type === 'string') return schema.type
  if (Array.isArray(schema.type)) {
    return schema.type.find(
      (value): value is string => typeof value === 'string' && value !== 'null',
    )
  }
  return undefined
}

function seedSchemaValue(
  value: unknown,
  required: boolean,
  root: unknown,
  visitedReferences: ReadonlySet<string> = new Set(),
): unknown | typeof omitSchemaValue {
  const schema = schemaRecord(value)
  if (!schema) return required ? null : omitSchemaValue

  if (typeof schema.$ref === 'string' && !visitedReferences.has(schema.$ref)) {
    const referenced = localSchemaReference(root, schema.$ref)
    if (referenced) {
      return seedSchemaValue(
        referenced,
        required,
        root,
        new Set([...visitedReferences, schema.$ref]),
      )
    }
  }

  if (Object.hasOwn(schema, 'default')) return schema.default
  if (Object.hasOwn(schema, 'const')) return schema.const
  if (Array.isArray(schema.enum) && schema.enum.length > 0)
    return schema.enum[0]

  for (const alternativesKey of ['oneOf', 'anyOf'] as const) {
    const alternatives = schema[alternativesKey]
    if (Array.isArray(alternatives) && alternatives.length > 0) {
      const seeded = seedSchemaValue(
        alternatives[0],
        required,
        root,
        visitedReferences,
      )
      if (seeded !== omitSchemaValue) return seeded
    }
  }

  const properties = schemaRecord(schema.properties)
  const type = schemaType(schema)
  if (properties || type === 'object') {
    const requiredNames = new Set(
      Array.isArray(schema.required)
        ? schema.required.filter(
            (property): property is string => typeof property === 'string',
          )
        : [],
    )
    const objectValue: Record<string, unknown> = {}
    for (const [name, propertySchema] of Object.entries(properties ?? {})) {
      const seeded = seedSchemaValue(
        propertySchema,
        requiredNames.has(name),
        root,
        visitedReferences,
      )
      if (seeded !== omitSchemaValue) objectValue[name] = seeded
    }
    if (required || Object.keys(objectValue).length > 0) {
      return objectValue
    }
  }

  if (!required) return omitSchemaValue
  if (type === 'string') return ''
  if (type === 'number' || type === 'integer') {
    if (typeof schema.minimum === 'number') {
      return type === 'integer' ? Math.ceil(schema.minimum) : schema.minimum
    }
    return 0
  }
  if (type === 'boolean') return false
  if (type === 'array') return []
  return null
}

function initialArgumentsJson(inputSchema: unknown) {
  const seeded = seedSchemaValue(inputSchema, true, inputSchema)
  const parsed = jsonObjectSchema.safeParse(seeded)
  return pretty(parsed.success ? parsed.data : {})
}

function readQuery() {
  const search = new URLSearchParams(window.location.search)
  const tab = inspectorTabSchema.safeParse(search.get('tab'))
  return {
    serverId: search.get('server'),
    tab: tab.success ? tab.data : 'tools',
  }
}

function updateQuery(serverId: string | null, tab: InspectorTab) {
  const url = new URL(window.location.href)
  if (serverId) url.searchParams.set('server', serverId)
  else url.searchParams.delete('server')
  url.searchParams.set('tab', tab)
  url.searchParams.delete('oauth')
  url.searchParams.delete('provider')
  url.searchParams.delete('connection_id')
  url.searchParams.delete('hookfish_status')
  url.searchParams.delete('connected')
  url.searchParams.delete('error')
  window.history.replaceState({}, '', url)
}

function saveServers(servers: SavedServer[]) {
  localStorage.setItem(storageKey, JSON.stringify(servers))
}

function loadServers() {
  try {
    const saved = serversSchema.safeParse(
      JSON.parse(localStorage.getItem(storageKey) ?? '[]'),
    )
    return saved.success ? saved.data : []
  } catch {
    return []
  }
}

function defaultName(url: string) {
  try {
    return new URL(url).hostname
  } catch {
    return 'MCP server'
  }
}

function serverInput(server: SavedServer) {
  return { url: server.url, connectionId: server.connectionId }
}

function Count({ children }: { children: number }) {
  return (
    <span className="font-mono text-[11px] tabular-nums text-stone-500 dark:text-stone-400">
      {String(children).padStart(2, '0')}
    </span>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-t border-stone-300 py-14 dark:border-stone-700">
      <p className="max-w-[48ch] text-sm leading-6 text-stone-500 dark:text-stone-400">
        {children}
      </p>
    </div>
  )
}

export function McpInspector() {
  const [servers, setServers] = useState<SavedServer[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<InspectorTab>('tools')
  const [newUrl, setNewUrl] = useState('')
  const [newName, setNewName] = useState('')
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [oauthCallbackError, setOauthCallbackError] = useState<string | null>(
    null,
  )
  const [output, setOutput] = useState<{
    title: string
    value: unknown
  } | null>(null)

  const selected = useMemo(
    () => servers.find((server) => server.id === selectedId) ?? null,
    [servers, selectedId],
  )
  const authenticationRequired = error?.startsWith('Authentication required.')

  useEffect(() => {
    const initialServers = loadServers()
    const query = readQuery()
    const callbackConnection = new URLSearchParams(window.location.search).get(
      'connection_id',
    )
    const callbackError = new URLSearchParams(window.location.search).get(
      'error',
    )
    const pendingId = localStorage.getItem(pendingAuthKey)
    const hydrated = callbackConnection
      ? initialServers.map((server) =>
          server.id === pendingId
            ? { ...server, connectionId: callbackConnection }
            : server,
        )
      : initialServers

    if (callbackConnection) {
      saveServers(hydrated)
      localStorage.removeItem(pendingAuthKey)
    } else if (callbackError) {
      const message = `OAuth callback failed: ${callbackError}`
      setOauthCallbackError(message)
      setError(message)
      localStorage.removeItem(pendingAuthKey)
    }

    const nextId =
      (callbackConnection && pendingId) ||
      (query.serverId && hydrated.some((item) => item.id === query.serverId)
        ? query.serverId
        : hydrated[0]?.id) ||
      null
    setServers(hydrated)
    setSelectedId(nextId)
    setTab(query.tab)
    updateQuery(nextId, query.tab)
  }, [])

  useEffect(() => {
    if (!selected) {
      setSnapshot(null)
      return
    }
    if (oauthCallbackError) return
    void inspect(selected)
  }, [selected?.id, selected?.connectionId, oauthCallbackError])

  async function inspect(server: SavedServer) {
    setBusy(true)
    setError(null)
    setSnapshot(null)
    try {
      setSnapshot(await inspectMcpServer({ data: serverInput(server) }))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  function chooseServer(id: string) {
    setOauthCallbackError(null)
    setSelectedId(id)
    setOutput(null)
    updateQuery(id, tab)
  }

  function chooseTab(nextTab: InspectorTab) {
    setTab(nextTab)
    updateQuery(selectedId, nextTab)
  }

  function addServer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const url = new URL(newUrl)
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Use an HTTP or HTTPS MCP server URL.')
      }
      const normalizedUrl = url.toString()
      const existing = servers.find((server) => server.url === normalizedUrl)
      if (existing) {
        chooseServer(existing.id)
        return
      }
      const server: SavedServer = {
        id: crypto.randomUUID(),
        name: newName.trim() || defaultName(normalizedUrl),
        url: normalizedUrl,
      }
      const next = [...servers, server]
      setServers(next)
      saveServers(next)
      setNewName('')
      setNewUrl('')
      setSelectedId(server.id)
      setTab('tools')
      updateQuery(server.id, 'tools')
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  function removeServer(server: SavedServer) {
    if (!window.confirm(`Remove ${server.name} from this inspector?`)) return
    const next = servers.filter((item) => item.id !== server.id)
    const nextId = selectedId === server.id ? (next[0]?.id ?? null) : selectedId
    setServers(next)
    saveServers(next)
    setSelectedId(nextId)
    setOutput(null)
    updateQuery(nextId, tab)
  }

  async function connectWithHookfish() {
    if (!selected) return
    setBusy(true)
    setOauthCallbackError(null)
    setError(null)
    try {
      const authorization = await authorizeMcpServer({
        data: { url: selected.url, label: selected.name },
      })
      localStorage.setItem(pendingAuthKey, selected.id)
      window.location.assign(authorization.authorize_url)
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  async function runAction(title: string, action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      setOutput({ title, value: await action() })
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-950 dark:bg-stone-950 dark:text-stone-50">
      <a
        href="#workspace"
        className="fixed left-3 top-3 z-50 -translate-y-20 bg-[#C8102E] px-4 py-3 text-sm font-semibold text-white focus:translate-y-0 motion-reduce:transition-none"
      >
        Skip to inspector
      </a>

      <header className="border-b border-stone-300 dark:border-stone-700">
        <div className="grid min-h-20 grid-cols-12 items-center gap-x-4 px-4 sm:px-6 lg:px-8">
          <div className="col-span-8 flex items-baseline gap-3 lg:col-span-4">
            <span className="h-3 w-3 bg-[#C8102E]" aria-hidden="true" />
            <h1 className="text-xl font-light tracking-tight">MCP Inspector</h1>
          </div>
          <p className="col-span-4 text-right font-mono text-[10px] uppercase tracking-[0.18em] text-stone-500 dark:text-stone-400 lg:col-span-8">
            Powered by Hookfish
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12">
        <aside className="border-b border-stone-300 lg:col-span-3 lg:min-h-[calc(100vh-5rem)] lg:border-b-0 lg:border-r dark:border-stone-700">
          <div className="p-4 sm:p-6 lg:p-8">
            <p className="mb-5 font-mono text-[10px] uppercase tracking-[0.18em] text-stone-500 dark:text-stone-400">
              Servers / {String(servers.length).padStart(2, '0')}
            </p>
            <form className="space-y-3" onSubmit={addServer}>
              <div>
                <label
                  className="mb-1.5 block text-xs font-semibold"
                  htmlFor="server-url"
                >
                  MCP server URL
                </label>
                <input
                  id="server-url"
                  name="server-url"
                  type="url"
                  required
                  autoComplete="url"
                  value={newUrl}
                  onChange={(event) => setNewUrl(event.target.value)}
                  placeholder="https://mcp.example.com/mcp…"
                  className="min-h-11 w-full border border-stone-400 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-stone-400 focus-visible:border-[#C8102E] focus-visible:ring-2 focus-visible:ring-[#C8102E]/30 dark:border-stone-600"
                />
              </div>
              <div>
                <label
                  className="mb-1.5 block text-xs font-semibold"
                  htmlFor="server-name"
                >
                  Label{' '}
                  <span className="font-normal text-stone-500">optional</span>
                </label>
                <input
                  id="server-name"
                  name="server-name"
                  type="text"
                  autoComplete="off"
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="Production docs…"
                  className="min-h-11 w-full border border-stone-400 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-stone-400 focus-visible:border-[#C8102E] focus-visible:ring-2 focus-visible:ring-[#C8102E]/30 dark:border-stone-600"
                />
              </div>
              <button
                type="submit"
                className="min-h-11 w-full bg-stone-950 px-4 text-sm font-semibold text-white hover:bg-[#C8102E] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C8102E] dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-[#C8102E] dark:hover:text-white"
              >
                Add server
              </button>
            </form>
          </div>

          <nav
            aria-label="MCP servers"
            className="border-t border-stone-300 dark:border-stone-700"
          >
            {servers.length === 0 ? (
              <p className="p-6 text-sm leading-6 text-stone-500 lg:p-8 dark:text-stone-400">
                Add any remote Streamable HTTP or HTTP + SSE endpoint to begin.
              </p>
            ) : (
              servers.map((server, index) => {
                const active = server.id === selectedId
                return (
                  <div
                    key={server.id}
                    className={`grid grid-cols-[1fr_auto] border-b border-stone-300 dark:border-stone-700 ${
                      active ? 'bg-stone-200 dark:bg-stone-800' : ''
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => chooseServer(server.id)}
                      aria-current={active ? 'page' : undefined}
                      className="min-w-0 px-4 py-4 text-left focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#C8102E] sm:px-6 lg:px-8"
                    >
                      <span className="mb-1 flex items-center gap-2 text-sm font-semibold">
                        <span className="font-mono text-[10px] text-stone-500 dark:text-stone-400">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <span className="truncate">{server.name}</span>
                      </span>
                      <span className="block truncate font-mono text-[10px] text-stone-500 dark:text-stone-400">
                        {server.url}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeServer(server)}
                      aria-label={`Remove ${server.name}`}
                      title={`Remove ${server.name}`}
                      className="min-h-11 min-w-11 px-3 text-stone-500 hover:text-[#C8102E] focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#C8102E] dark:text-stone-400"
                    >
                      ×
                    </button>
                  </div>
                )
              })
            )}
          </nav>
        </aside>

        <main id="workspace" className="min-w-0 lg:col-span-9">
          {!selected ? (
            <section className="grid min-h-[calc(100vh-5rem)] grid-cols-12 content-center gap-x-4 px-4 py-16 sm:px-6 lg:px-8">
              <div className="col-span-12 md:col-span-8 md:col-start-2 xl:col-span-6 xl:col-start-3">
                <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.18em] text-[#C8102E]">
                  No server selected
                </p>
                <h2 className="text-4xl font-light leading-tight tracking-[-0.035em] sm:text-5xl">
                  See what an MCP server can do.
                </h2>
                <p className="mt-6 max-w-[55ch] text-base leading-7 text-stone-600 dark:text-stone-300">
                  Add an endpoint to discover its tools, resources, templates,
                  and prompts. Execute every capability without exposing OAuth
                  tokens to the browser.
                </p>
              </div>
            </section>
          ) : (
            <>
              <section className="border-b border-stone-300 px-4 py-8 sm:px-6 lg:px-8 lg:py-10 dark:border-stone-700">
                <div className="grid grid-cols-12 gap-x-4 gap-y-6">
                  <div className="col-span-12 xl:col-span-8">
                    <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[#C8102E]">
                      {busy
                        ? 'Request in progress'
                        : snapshot
                          ? 'Connected'
                          : 'Not connected'}
                    </p>
                    <h2 className="break-words text-3xl font-light tracking-[-0.03em] sm:text-4xl">
                      {snapshot?.serverInfo?.title ??
                        snapshot?.serverInfo?.name ??
                        selected.name}
                    </h2>
                    <p className="mt-3 break-all font-mono text-xs leading-5 text-stone-500 dark:text-stone-400">
                      {selected.url}
                    </p>
                  </div>
                  <div className="col-span-12 flex items-end gap-3 xl:col-span-4 xl:justify-end">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void inspect(selected)}
                      className="min-h-11 border border-stone-400 px-4 text-sm font-semibold hover:border-[#C8102E] hover:text-[#C8102E] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C8102E] disabled:cursor-wait disabled:opacity-50 dark:border-stone-600"
                    >
                      Refresh
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void connectWithHookfish()}
                      className="min-h-11 bg-[#C8102E] px-4 text-sm font-semibold text-white hover:bg-[#a90d26] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C8102E] disabled:cursor-wait disabled:opacity-50"
                    >
                      {selected.connectionId
                        ? 'Reconnect OAuth'
                        : 'Connect OAuth'}
                    </button>
                  </div>
                </div>

                {snapshot ? (
                  <dl className="mt-8 grid grid-cols-2 gap-px border border-stone-300 bg-stone-300 sm:grid-cols-4 dark:border-stone-700 dark:bg-stone-700">
                    {[
                      ['Transport', snapshot.transport],
                      ['Protocol', snapshot.protocolVersion ?? 'Unknown'],
                      ['Tools', snapshot.tools.length],
                      [
                        'Readable',
                        snapshot.resources.length +
                          snapshot.resourceTemplates.length,
                      ],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="bg-stone-50 p-3 dark:bg-stone-950"
                      >
                        <dt className="font-mono text-[9px] uppercase tracking-[0.14em] text-stone-500 dark:text-stone-400">
                          {label}
                        </dt>
                        <dd className="mt-1 truncate font-mono text-xs tabular-nums">
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </section>

              <div aria-live="polite" aria-atomic="true">
                {error ? (
                  <div className="flex flex-col items-start gap-3 border-b border-[#C8102E] bg-[#C8102E]/8 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
                    <p className="max-w-[70ch] text-sm leading-6 text-[#9f0c24] dark:text-red-300">
                      {error}
                    </p>
                    {authenticationRequired ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void connectWithHookfish()}
                        className="min-h-11 shrink-0 bg-[#C8102E] px-4 text-sm font-semibold text-white hover:bg-[#a90d26] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C8102E] disabled:cursor-wait disabled:opacity-50"
                      >
                        Authorize with Hookfish
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="border-b border-stone-300 px-4 sm:px-6 lg:px-8 dark:border-stone-700">
                <nav
                  aria-label="Server capabilities"
                  className="flex overflow-x-auto"
                >
                  {tabs.map((item) => {
                    const count = snapshot
                      ? item.id === 'tools'
                        ? snapshot.tools.length
                        : item.id === 'resources'
                          ? snapshot.resources.length +
                            snapshot.resourceTemplates.length
                          : item.id === 'prompts'
                            ? snapshot.prompts.length
                            : 1
                      : 0
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => chooseTab(item.id)}
                        className={`flex min-h-14 shrink-0 items-center gap-3 border-b-2 px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#C8102E] ${
                          tab === item.id
                            ? 'border-[#C8102E] text-stone-950 dark:text-stone-50'
                            : 'border-transparent text-stone-500 hover:text-stone-950 dark:text-stone-400 dark:hover:text-stone-50'
                        }`}
                      >
                        {item.label} <Count>{count}</Count>
                      </button>
                    )
                  })}
                </nav>
              </div>

              <section className="px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
                {busy && !snapshot ? (
                  <EmptyState>
                    Connecting and negotiating MCP capabilities…
                  </EmptyState>
                ) : !snapshot ? (
                  <EmptyState>
                    This server has not returned an MCP capability manifest.
                    Check the endpoint, or connect OAuth if authentication is
                    required.
                  </EmptyState>
                ) : tab === 'tools' ? (
                  <ToolsPanel
                    server={selected}
                    tools={snapshot.tools}
                    busy={busy}
                    runAction={runAction}
                  />
                ) : tab === 'resources' ? (
                  <ResourcesPanel
                    server={selected}
                    resources={snapshot.resources}
                    templates={snapshot.resourceTemplates}
                    busy={busy}
                    runAction={runAction}
                  />
                ) : tab === 'prompts' ? (
                  <PromptsPanel
                    server={selected}
                    prompts={snapshot.prompts}
                    busy={busy}
                    runAction={runAction}
                  />
                ) : (
                  <ServerPanel snapshot={snapshot} />
                )}
              </section>
            </>
          )}
        </main>
      </div>

      {output ? (
        <section
          aria-label="MCP response"
          className="fixed inset-x-0 bottom-0 z-40 max-h-[55vh] overflow-auto border-t-2 border-[#C8102E] bg-stone-950 text-stone-100 shadow-[0_-16px_40px_rgba(0,0,0,0.18)]"
        >
          <div className="sticky top-0 flex min-h-14 items-center justify-between border-b border-stone-700 bg-stone-950 px-4 sm:px-6 lg:px-8">
            <h2 className="text-sm font-semibold">{output.title}</h2>
            <button
              type="button"
              onClick={() => setOutput(null)}
              className="min-h-11 min-w-11 text-xl text-stone-400 hover:text-white focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#C8102E]"
              aria-label="Close response"
              title="Close response"
            >
              ×
            </button>
          </div>
          <pre className="overflow-auto p-4 font-mono text-xs leading-6 sm:px-6 lg:px-8">
            {pretty(output.value)}
          </pre>
        </section>
      ) : null}
    </div>
  )
}

type ActionProps = {
  server: SavedServer
  busy: boolean
  runAction: (title: string, action: () => Promise<unknown>) => Promise<void>
}

function ToolsPanel({
  server,
  tools,
  busy,
  runAction,
}: ActionProps & { tools: Snapshot['tools'] }) {
  if (tools.length === 0)
    return <EmptyState>This server exposes no tools.</EmptyState>
  return (
    <div className="border-t border-stone-300 dark:border-stone-700">
      {tools.map((tool, index) => (
        <ToolCard
          key={tool.name}
          server={server}
          tool={tool}
          index={index}
          busy={busy}
          runAction={runAction}
        />
      ))}
    </div>
  )
}

function ToolCard({
  server,
  tool,
  index,
  busy,
  runAction,
}: ActionProps & { tool: Snapshot['tools'][number]; index: number }) {
  const [argumentsJson, setArgumentsJson] = useState(() =>
    initialArgumentsJson(tool.inputSchema),
  )
  const [parseError, setParseError] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [executionOpen, setExecutionOpen] = useState(false)
  const detailsButtonRef = useRef<HTMLButtonElement>(null)
  const executionId = `tool-execution-${index}`
  const closeDetails = useCallback(() => setDetailsOpen(false), [])
  async function execute() {
    try {
      const args = parseObject(argumentsJson)
      setParseError(null)
      await runAction(`Tool · ${tool.name}`, () =>
        executeMcpTool({
          data: { ...serverInput(server), name: tool.name, arguments: args },
        }),
      )
    } catch (cause) {
      setParseError(`Arguments must be a JSON object. ${errorMessage(cause)}`)
    }
  }
  return (
    <article className="border-b border-stone-300 dark:border-stone-700">
      <div className="grid min-h-20 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-3 py-3 sm:gap-5 sm:px-4">
        <p className="pt-1 font-mono text-[10px] tabular-nums text-stone-500 dark:text-stone-400">
          {String(index + 1).padStart(2, '0')}
        </p>
        <div className="min-w-0">
          <div className="flex min-w-0 items-baseline gap-3">
            <h3 className="truncate text-base font-semibold">
              {tool.title ?? tool.name}
            </h3>
            {tool.title ? (
              <span className="hidden truncate font-mono text-[10px] text-stone-500 sm:inline dark:text-stone-400">
                {tool.name}
              </span>
            ) : null}
          </div>
          <p className="mt-1 max-w-[70ch] truncate text-sm leading-5 text-stone-500 dark:text-stone-400">
            {tool.description ?? 'No description provided.'}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            ref={detailsButtonRef}
            type="button"
            aria-expanded={detailsOpen}
            aria-haspopup="dialog"
            aria-label={`View details for ${tool.title ?? tool.name}`}
            title="View tool details"
            onClick={() => setDetailsOpen(true)}
            className="grid min-h-11 min-w-11 place-items-center border border-transparent text-stone-500 hover:border-stone-300 hover:text-[#C8102E] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C8102E] dark:text-stone-400 dark:hover:border-stone-700"
          >
            <EyeIcon />
          </button>
          <button
            type="button"
            aria-expanded={executionOpen}
            aria-controls={executionId}
            aria-label={`${executionOpen ? 'Hide execution for' : 'Execute'} ${tool.title ?? tool.name}`}
            title={executionOpen ? 'Hide execution' : 'Execute tool'}
            onClick={() => setExecutionOpen((value) => !value)}
            className={`min-h-11 min-w-11 border text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C8102E] ${
              executionOpen
                ? 'border-[#C8102E] bg-[#C8102E] text-white'
                : 'border-stone-400 text-stone-950 hover:border-[#C8102E] hover:text-[#C8102E] dark:border-stone-600 dark:text-stone-50'
            }`}
          >
            ▶
          </button>
        </div>
      </div>

      {detailsOpen ? (
        <ToolDetailsSheet
          tool={tool}
          onClose={closeDetails}
          returnFocusRef={detailsButtonRef}
        />
      ) : null}

      {executionOpen ? (
        <div
          id={executionId}
          className="border-t border-[#C8102E] bg-stone-100 px-3 py-5 sm:px-4 dark:bg-stone-900"
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#C8102E]">
            Execute / {tool.name}
          </p>
          <p className="mt-2 max-w-[60ch] text-xs leading-5 text-stone-500 dark:text-stone-400">
            Pass a JSON object matching the tool’s input schema.
          </p>
          <div className="mt-5">
            <label
              className="mb-2 block text-xs font-semibold"
              htmlFor={`tool-${index}`}
            >
              Arguments · JSON object
            </label>
            <textarea
              id={`tool-${index}`}
              name={`tool-${tool.name}-arguments`}
              value={argumentsJson}
              onChange={(event) => setArgumentsJson(event.target.value)}
              spellCheck={false}
              rows={7}
              className="w-full resize-y border border-stone-400 bg-stone-50 p-3 font-mono text-xs leading-5 outline-none focus-visible:border-[#C8102E] focus-visible:ring-2 focus-visible:ring-[#C8102E]/30 dark:border-stone-600 dark:bg-stone-950"
            />
            {parseError ? (
              <p className="mt-2 text-xs text-[#C8102E]">{parseError}</p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => void execute()}
                className="min-h-11 bg-[#C8102E] px-5 text-sm font-semibold text-white hover:bg-[#a90d26] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C8102E] disabled:cursor-wait disabled:opacity-50"
              >
                Execute tool
              </button>
              <button
                type="button"
                onClick={() => {
                  setExecutionOpen(false)
                  setParseError(null)
                }}
                className="min-h-11 border border-stone-400 px-5 text-sm font-semibold text-stone-700 hover:border-[#C8102E] hover:text-[#C8102E] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C8102E] dark:border-stone-600 dark:text-stone-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  )
}

function EyeIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M2.75 12s3.5-6 9.25-6 9.25 6 9.25 6-3.5 6-9.25 6S2.75 12 2.75 12Z" />
      <circle cx="12" cy="12" r="2.75" />
    </svg>
  )
}

function ToolDetailSection({
  label,
  value,
  open = false,
}: {
  label: string
  value: unknown
  open?: boolean
}) {
  return (
    <details
      open={open}
      className="group border-b border-stone-200 dark:border-stone-800"
    >
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#C8102E] [&::-webkit-details-marker]:hidden">
        <span>{label}</span>
        <span
          aria-hidden="true"
          className="font-mono text-base font-normal text-stone-900/40 group-open:hidden dark:text-stone-50/40"
        >
          +
        </span>
        <span
          aria-hidden="true"
          className="hidden font-mono text-base font-normal text-stone-900/40 group-open:inline dark:text-stone-50/40"
        >
          −
        </span>
      </summary>
      <pre className="mb-6 overflow-auto border-l-2 border-stone-300 pl-4 font-mono text-[11px] leading-5 text-stone-900/70 dark:border-stone-700 dark:text-stone-50/70">
        {pretty(value)}
      </pre>
    </details>
  )
}

function ToolDetailsSheet({
  tool,
  onClose,
  returnFocusRef,
}: {
  tool: Snapshot['tools'][number]
  onClose: () => void
  returnFocusRef: React.RefObject<HTMLButtonElement | null>
}) {
  const sheetRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const titleId = `tool-sheet-${tool.name.replaceAll(/[^a-zA-Z0-9_-]/g, '-')}`

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = Array.from(
        sheetRef.current?.querySelectorAll<HTMLElement>(
          'button, summary, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => !element.hasAttribute('disabled'))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
      returnFocusRef.current?.focus()
    }
  }, [onClose, returnFocusRef])

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close tool details"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-stone-950/50"
      />
      <aside
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-stone-300 bg-stone-50 text-stone-950 shadow-[-24px_0_64px_rgba(0,0,0,0.18)] sm:max-w-xl lg:max-w-2xl dark:border-stone-700 dark:bg-stone-950 dark:text-stone-50"
      >
        <header className="flex min-h-20 shrink-0 items-center justify-between gap-8 border-b border-stone-300 px-4 sm:px-8 dark:border-stone-700">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#C8102E]">
              Tool details
            </p>
            <h2
              id={titleId}
              className="mt-1 truncate text-xl font-light tracking-tight"
            >
              {tool.title ?? tool.name}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="min-h-11 min-w-11 border border-stone-300 text-xl text-stone-900/70 hover:border-[#C8102E] hover:text-[#C8102E] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C8102E] dark:border-stone-700 dark:text-stone-50/70"
            aria-label="Close tool details"
            title="Close tool details"
          >
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:px-8 sm:py-12">
          <div className="grid grid-cols-12 gap-x-4 gap-y-8">
            <div className="col-span-12 sm:col-span-8">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-stone-900/40 dark:text-stone-50/40">
                Description
              </p>
              <p className="mt-3 max-w-[60ch] text-sm leading-relaxed text-stone-900/70 dark:text-stone-50/70">
                {tool.description ?? 'No description provided.'}
              </p>
            </div>
            <dl className="col-span-12 grid grid-cols-2 gap-4 border-t border-stone-300 pt-6 sm:col-span-4 sm:block sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0 dark:border-stone-700">
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-stone-900/40 dark:text-stone-50/40">
                  Name
                </dt>
                <dd className="mt-2 break-all font-mono text-xs">
                  {tool.name}
                </dd>
              </div>
              <div className="sm:mt-6">
                <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-stone-900/40 dark:text-stone-50/40">
                  Output schema
                </dt>
                <dd className="mt-2 text-xs font-semibold">
                  {tool.outputSchema === undefined
                    ? 'Not provided'
                    : 'Provided'}
                </dd>
              </div>
            </dl>
          </div>

          <div className="mt-12 border-t border-stone-300 dark:border-stone-700">
            <ToolDetailSection
              label="Input schema"
              value={tool.inputSchema}
              open
            />
            {tool.outputSchema !== undefined ? (
              <ToolDetailSection
                label="Output schema"
                value={tool.outputSchema}
                open
              />
            ) : null}
            {tool.annotations !== undefined ? (
              <ToolDetailSection label="Annotations" value={tool.annotations} />
            ) : null}
            {tool.execution !== undefined ? (
              <ToolDetailSection label="Execution" value={tool.execution} />
            ) : null}
            {tool.icons !== undefined ? (
              <ToolDetailSection label="Icons" value={tool.icons} />
            ) : null}
            {tool._meta !== undefined ? (
              <ToolDetailSection label="Metadata" value={tool._meta} />
            ) : null}
            <ToolDetailSection label="Raw tool descriptor" value={tool} />
          </div>
        </div>
      </aside>
    </div>
  )
}

function ResourcesPanel({
  server,
  resources,
  templates,
  busy,
  runAction,
}: ActionProps & {
  resources: Snapshot['resources']
  templates: Snapshot['resourceTemplates']
}) {
  const [uri, setUri] = useState('')
  if (resources.length === 0 && templates.length === 0) {
    return (
      <EmptyState>
        This server exposes no resources or resource templates.
      </EmptyState>
    )
  }
  return (
    <div className="space-y-10">
      {resources.length > 0 ? (
        <div>
          <h3 className="mb-5 text-xl font-light">Static resources</h3>
          <div className="border-t border-stone-300 dark:border-stone-700">
            {resources.map((resource, index) => (
              <article
                key={resource.uri}
                className="grid grid-cols-12 gap-x-4 gap-y-4 border-b border-stone-300 py-5 dark:border-stone-700"
              >
                <div className="col-span-12 md:col-span-9">
                  <p className="font-mono text-[10px] text-stone-500">
                    RESOURCE / {String(index + 1).padStart(2, '0')}
                  </p>
                  <h4 className="mt-2 text-base font-semibold">
                    {resource.title ?? resource.name}
                  </h4>
                  <p className="mt-2 break-all font-mono text-xs text-stone-500 dark:text-stone-400">
                    {resource.uri}
                  </p>
                  {resource.description ? (
                    <p className="mt-3 max-w-[60ch] text-sm leading-6 text-stone-600 dark:text-stone-300">
                      {resource.description}
                    </p>
                  ) : null}
                </div>
                <div className="col-span-12 md:col-span-3 md:text-right">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void runAction(`Resource · ${resource.name}`, () =>
                        readMcpResource({
                          data: { ...serverInput(server), uri: resource.uri },
                        }),
                      )
                    }
                    className="min-h-11 border border-stone-400 px-4 text-sm font-semibold hover:border-[#C8102E] hover:text-[#C8102E] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C8102E] disabled:opacity-50 dark:border-stone-600"
                  >
                    Read
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : null}
      {templates.length > 0 ? (
        <div>
          <h3 className="mb-5 text-xl font-light">Resource templates</h3>
          <div className="grid grid-cols-12 gap-x-4 gap-y-5 border-t border-stone-300 pt-5 dark:border-stone-700">
            <div className="col-span-12 lg:col-span-5">
              {templates.map((template) => (
                <button
                  key={template.uriTemplate}
                  type="button"
                  onClick={() => setUri(template.uriTemplate)}
                  className="block min-h-11 w-full border-b border-stone-300 py-3 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#C8102E] dark:border-stone-700"
                >
                  <span className="block text-sm font-semibold">
                    {template.title ?? template.name}
                  </span>
                  <span className="mt-1 block break-all font-mono text-[10px] text-stone-500">
                    {template.uriTemplate}
                  </span>
                </button>
              ))}
            </div>
            <div className="col-span-12 lg:col-span-7">
              <label
                className="mb-2 block text-xs font-semibold"
                htmlFor="resource-uri"
              >
                Resolved resource URI
              </label>
              <input
                id="resource-uri"
                name="resource-uri"
                type="text"
                autoComplete="off"
                value={uri}
                onChange={(event) => setUri(event.target.value)}
                placeholder="Replace template variables…"
                className="min-h-11 w-full border border-stone-400 bg-transparent px-3 font-mono text-xs outline-none focus-visible:border-[#C8102E] focus-visible:ring-2 focus-visible:ring-[#C8102E]/30 dark:border-stone-600"
              />
              <button
                type="button"
                disabled={busy || !uri}
                onClick={() =>
                  void runAction('Resource', () =>
                    readMcpResource({ data: { ...serverInput(server), uri } }),
                  )
                }
                className="mt-3 min-h-11 bg-[#C8102E] px-5 text-sm font-semibold text-white hover:bg-[#a90d26] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C8102E] disabled:opacity-50"
              >
                Read resource
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function PromptsPanel({
  server,
  prompts,
  busy,
  runAction,
}: ActionProps & { prompts: Snapshot['prompts'] }) {
  if (prompts.length === 0)
    return <EmptyState>This server exposes no prompts.</EmptyState>
  return (
    <div className="space-y-10">
      {prompts.map((prompt, index) => (
        <PromptCard
          key={prompt.name}
          server={server}
          prompt={prompt}
          index={index}
          busy={busy}
          runAction={runAction}
        />
      ))}
    </div>
  )
}

function PromptCard({
  server,
  prompt,
  index,
  busy,
  runAction,
}: ActionProps & { prompt: Snapshot['prompts'][number]; index: number }) {
  const [argumentsJson, setArgumentsJson] = useState('{}')
  const [parseError, setParseError] = useState<string | null>(null)
  async function render() {
    try {
      const args = parseStringObject(argumentsJson)
      setParseError(null)
      await runAction(`Prompt · ${prompt.name}`, () =>
        renderMcpPrompt({
          data: { ...serverInput(server), name: prompt.name, arguments: args },
        }),
      )
    } catch (cause) {
      setParseError(
        `Arguments must be a JSON object of strings. ${errorMessage(cause)}`,
      )
    }
  }
  return (
    <article className="grid grid-cols-12 gap-x-4 gap-y-5 border-t border-stone-300 pt-5 dark:border-stone-700">
      <div className="col-span-12 lg:col-span-5">
        <p className="font-mono text-[10px] text-stone-500">
          PROMPT / {String(index + 1).padStart(2, '0')}
        </p>
        <h3 className="mt-2 text-xl font-light">
          {prompt.title ?? prompt.name}
        </h3>
        <p className="mt-4 max-w-[55ch] text-sm leading-6 text-stone-600 dark:text-stone-300">
          {prompt.description ?? 'No description provided.'}
        </p>
        {prompt.arguments?.length ? (
          <ul className="mt-5 space-y-2 text-xs">
            {prompt.arguments.map((argument) => (
              <li
                key={argument.name}
                className="border-l-2 border-stone-300 pl-3 dark:border-stone-700"
              >
                <span className="font-mono">{argument.name}</span>
                {argument.required ? ' · required' : ''}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="col-span-12 lg:col-span-7">
        <label
          className="mb-2 block text-xs font-semibold"
          htmlFor={`prompt-${index}`}
        >
          Arguments · JSON strings
        </label>
        <textarea
          id={`prompt-${index}`}
          name={`prompt-${prompt.name}-arguments`}
          value={argumentsJson}
          onChange={(event) => setArgumentsJson(event.target.value)}
          spellCheck={false}
          rows={7}
          className="w-full resize-y border border-stone-400 bg-stone-100 p-3 font-mono text-xs leading-5 outline-none focus-visible:border-[#C8102E] focus-visible:ring-2 focus-visible:ring-[#C8102E]/30 dark:border-stone-600 dark:bg-stone-900"
        />
        {parseError ? (
          <p className="mt-2 text-xs text-[#C8102E]">{parseError}</p>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => void render()}
          className="mt-3 min-h-11 bg-[#C8102E] px-5 text-sm font-semibold text-white hover:bg-[#a90d26] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C8102E] disabled:opacity-50"
        >
          Get prompt
        </button>
      </div>
    </article>
  )
}

function ServerPanel({ snapshot }: { snapshot: Snapshot }) {
  const [instructionsExpanded, setInstructionsExpanded] = useState(false)
  const instructions =
    snapshot.instructions ?? 'This server did not provide client instructions.'
  const instructionsExpandable =
    snapshot.instructions !== null &&
    (instructions.length > 180 || instructions.includes('\n'))

  return (
    <div>
      <section className="border-t border-stone-300 dark:border-stone-700">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-5">
          <div className="min-w-0">
            <h3 className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-stone-500">
              Instructions
            </h3>
            <p
              id="server-instructions"
              className={`max-w-[70ch] whitespace-pre-wrap text-sm leading-7 text-stone-600 dark:text-stone-300 ${
                instructionsExpandable && !instructionsExpanded
                  ? 'line-clamp-2'
                  : ''
              }`}
            >
              {instructions}
            </p>
          </div>
          {instructionsExpandable ? (
            <button
              type="button"
              aria-expanded={instructionsExpanded}
              aria-controls="server-instructions"
              aria-label={`${instructionsExpanded ? 'Collapse' : 'Expand'} server instructions`}
              title={`${instructionsExpanded ? 'Collapse' : 'Expand'} instructions`}
              onClick={() => setInstructionsExpanded((value) => !value)}
              className="min-h-11 whitespace-nowrap px-3 text-xs font-semibold text-stone-500 hover:text-[#C8102E] focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#C8102E] dark:text-stone-400"
            >
              {instructionsExpanded ? 'Show less ↑' : 'Show more ↓'}
            </button>
          ) : null}
        </div>
      </section>

      <section className="border-t border-stone-300 pt-5 dark:border-stone-700">
        <h3 className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-stone-500">
          Capabilities
        </h3>
        <pre className="overflow-auto border-l-2 border-[#C8102E] bg-stone-100 p-4 font-mono text-xs leading-6 dark:bg-stone-900">
          {pretty({
            serverInfo: snapshot.serverInfo,
            protocolVersion: snapshot.protocolVersion,
            protocolEra: snapshot.protocolEra,
            transport: snapshot.transport,
            capabilities: snapshot.capabilities,
          })}
        </pre>
      </section>
    </div>
  )
}
