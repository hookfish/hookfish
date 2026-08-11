import { createHash, randomUUID } from 'node:crypto'
import {
  Client,
  SdkHttpError,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} from '@modelcontextprotocol/client'
import '@tanstack/react-start/server-only'
import { z } from 'zod'
import { handleHookfishRequest } from './hookfish.server'

type ConnectionInput = {
  url: string
  connectionId?: string
}

type ConnectedClient = {
  client: Client
  transport: 'Streamable HTTP' | 'HTTP + SSE'
}

const hookfishErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
})

const tokenSchema = z.object({ access_token: z.string().min(1) })
const authorizeSchema = z.object({
  connection_id: z.string(),
  authorize_url: z.url(),
})

function apiKey() {
  return process.env.HOOKFISH_API_KEY || 'test'
}

function describeError(error: unknown): string {
  if (error instanceof UnauthorizedError) {
    return 'Authentication required. Connect this server with Hookfish, then inspect it again.'
  }
  if (
    error instanceof SdkHttpError &&
    (error.status === 401 || error.status === 403)
  ) {
    return 'Authentication required. Connect this server with Hookfish, then inspect it again.'
  }
  return error instanceof Error ? error.message : 'The MCP request failed.'
}

function isAuthenticationError(error: unknown) {
  return (
    error instanceof UnauthorizedError ||
    (error instanceof SdkHttpError &&
      (error.status === 401 || error.status === 403))
  )
}

async function hookfishRequest(
  origin: string,
  pathname: string,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${apiKey()}`)
  if (init.body) headers.set('Content-Type', 'application/json')

  const response = await handleHookfishRequest(
    new Request(new URL(pathname, origin), { ...init, headers }),
  )
  if (response.ok) return response

  const payload: unknown = await response.json().catch(() => undefined)
  const parsed = hookfishErrorSchema.safeParse(payload)
  throw new Error(
    parsed.success
      ? parsed.data.error.message
      : `Hookfish returned HTTP ${response.status}.`,
  )
}

async function accessToken(origin: string, connectionId?: string) {
  if (!connectionId) return undefined
  const response = await hookfishRequest(
    origin,
    `/api/oauth/tokens/${encodeURIComponent(connectionId)}`,
  )
  return tokenSchema.parse(await response.json()).access_token
}

function clientOptions(accessToken?: string) {
  return {
    ...(accessToken
      ? { authProvider: { token: async () => accessToken } }
      : {}),
    onInsufficientScope: 'throw' as const,
  }
}

function createClient() {
  return new Client(
    { name: 'hookfish-mcp-inspector', version: '0.0.0' },
    { versionNegotiation: { mode: 'auto' } },
  )
}

async function listAllTools(client: Client) {
  const items: Awaited<ReturnType<Client['listTools']>>['tools'] = []
  let cursor: string | undefined
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined)
    items.push(...page.tools)
    cursor = page.nextCursor
  } while (cursor)
  return items
}

async function listAllResources(client: Client) {
  const items: Awaited<ReturnType<Client['listResources']>>['resources'] = []
  let cursor: string | undefined
  do {
    const page = await client.listResources(cursor ? { cursor } : undefined)
    items.push(...page.resources)
    cursor = page.nextCursor
  } while (cursor)
  return items
}

async function listAllResourceTemplates(client: Client) {
  const items: Awaited<
    ReturnType<Client['listResourceTemplates']>
  >['resourceTemplates'] = []
  let cursor: string | undefined
  do {
    const page = await client.listResourceTemplates(
      cursor ? { cursor } : undefined,
    )
    items.push(...page.resourceTemplates)
    cursor = page.nextCursor
  } while (cursor)
  return items
}

async function listAllPrompts(client: Client) {
  const items: Awaited<ReturnType<Client['listPrompts']>>['prompts'] = []
  let cursor: string | undefined
  do {
    const page = await client.listPrompts(cursor ? { cursor } : undefined)
    items.push(...page.prompts)
    cursor = page.nextCursor
  } while (cursor)
  return items
}

async function connect(
  input: ConnectionInput,
  origin: string,
): Promise<ConnectedClient> {
  const url = new URL(input.url)
  const token = await accessToken(origin, input.connectionId)
  const streamableClient = createClient()

  try {
    await streamableClient.connect(
      new StreamableHTTPClientTransport(url, clientOptions(token)),
    )
    return { client: streamableClient, transport: 'Streamable HTTP' }
  } catch (streamableError) {
    await streamableClient.close().catch(() => undefined)
    if (isAuthenticationError(streamableError)) {
      const action = input.connectionId ? 'Reconnect OAuth' : 'Connect OAuth'
      throw new Error(
        `Authentication required. Use ${action} to authorize this Streamable HTTP server with Hookfish.`,
      )
    }
    const sseClient = createClient()
    try {
      await sseClient.connect(new SSEClientTransport(url, clientOptions(token)))
      return { client: sseClient, transport: 'HTTP + SSE' }
    } catch (sseError) {
      await sseClient.close().catch(() => undefined)
      const message = [describeError(streamableError), describeError(sseError)]
        .filter((value, index, values) => values.indexOf(value) === index)
        .join(' ')
      throw new Error(message)
    }
  }
}

async function withClient<T>(
  input: ConnectionInput,
  origin: string,
  operation: (connection: ConnectedClient) => Promise<T>,
) {
  const connection = await connect(input, origin)
  try {
    return await operation(connection)
  } finally {
    await connection.client.close().catch(() => undefined)
  }
}

export async function inspectServer(input: ConnectionInput, origin: string) {
  return withClient(input, origin, async ({ client, transport }) => {
    const capabilities = client.getServerCapabilities() ?? {}
    const [tools, resources, resourceTemplates, prompts] = await Promise.all([
      capabilities.tools ? listAllTools(client) : [],
      capabilities.resources ? listAllResources(client) : [],
      capabilities.resources ? listAllResourceTemplates(client) : [],
      capabilities.prompts ? listAllPrompts(client) : [],
    ])

    return {
      serverInfo: client.getServerVersion() ?? null,
      capabilities,
      instructions: client.getInstructions() ?? null,
      protocolVersion: client.getNegotiatedProtocolVersion() ?? null,
      protocolEra: client.getProtocolEra() ?? null,
      transport,
      tools,
      resources,
      resourceTemplates,
      prompts,
    }
  })
}

export async function executeTool(
  input: ConnectionInput & {
    name: string
    arguments: Record<string, unknown>
  },
  origin: string,
) {
  return withClient(input, origin, async ({ client }) => {
    await client.listTools()
    return client.callTool({ name: input.name, arguments: input.arguments })
  })
}

export async function readResource(
  input: ConnectionInput & { uri: string },
  origin: string,
) {
  return withClient(input, origin, ({ client }) =>
    client.readResource({ uri: input.uri }),
  )
}

export async function renderPrompt(
  input: ConnectionInput & {
    name: string
    arguments: Record<string, string>
  },
  origin: string,
) {
  return withClient(input, origin, ({ client }) =>
    client.getPrompt({ name: input.name, arguments: input.arguments }),
  )
}

export async function authorizeServer(
  input: { url: string; label: string },
  origin: string,
) {
  const hash = createHash('sha256')
    .update(`${origin}\0${input.url}`)
    .digest('hex')
    .slice(0, 16)
  const providerId = `inspector-${hash}`
  const providerPath = `/api/admin/providers/${providerId}`
  const existing = await handleHookfishRequest(
    new Request(new URL(providerPath, origin), {
      headers: { Authorization: `Bearer ${apiKey()}` },
    }),
  )

  if (existing.status === 404) {
    await hookfishRequest(origin, providerPath, {
      method: 'PUT',
      body: JSON.stringify({
        template: 'mcp',
        label: input.label,
        configuration: { resource_url: input.url, scopes: [] },
        credentials: { mode: 'register' },
        enabled: true,
      }),
    })
  } else if (!existing.ok) {
    const payload: unknown = await existing.json().catch(() => undefined)
    const parsed = hookfishErrorSchema.safeParse(payload)
    throw new Error(
      parsed.success
        ? parsed.data.error.message
        : `Hookfish returned HTTP ${existing.status}.`,
    )
  }

  const returnTo = new URL('/', origin)
  returnTo.searchParams.set('oauth', 'complete')
  returnTo.searchParams.set('provider', providerId)
  const response = await hookfishRequest(
    origin,
    `/api/oauth/authorize/${providerId}`,
    {
      method: 'POST',
      body: JSON.stringify({
        connection_id: `${providerId}-${randomUUID()}`,
        scopes: [],
        return_to: returnTo.toString(),
      }),
    },
  )

  return { ...authorizeSchema.parse(await response.json()), providerId }
}
