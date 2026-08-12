import { createHash } from 'node:crypto'
import {
  Client,
  SdkHttpError,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  UrlElicitationRequiredError,
} from '@modelcontextprotocol/client'
import '@tanstack/react-start/server-only'
import { z } from 'zod'
import {
  beginElicitationOperation,
  completeUrlElicitation,
  finishElicitationOperation,
  waitForElicitation,
} from './elicitation.server'
import { handleHookfishRequest } from './hookfish.server'
import type { InspectorFeatures } from './inspector-features'

type ConnectionInput = {
  url: string
  connectionPath?: string
  actionId?: string
  features: InspectorFeatures
}

type ConnectedClient = {
  client: Client
  transport: 'Streamable HTTP' | 'HTTP + SSE'
}

const hookfishErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
})

const accessSchema = z.object({ secret: z.string().min(1) })
const authorizationRequiredSchema = z.object({
  error: z.object({
    code: z.literal('authorization_required'),
    authorize_url: z.url(),
  }),
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

async function accessToken(origin: string, connectionPath?: string) {
  if (!connectionPath) return undefined
  const response = await hookfishRequest(
    origin,
    `/api/connections/access/${connectionPath.split('/').map(encodeURIComponent).join('/')}`,
    { method: 'POST' },
  )
  return accessSchema.parse(await response.json()).secret
}

function clientOptions(accessToken?: string) {
  return {
    ...(accessToken
      ? { authProvider: { token: async () => accessToken } }
      : {}),
    onInsufficientScope: 'throw' as const,
  }
}

function createClient(input: ConnectionInput) {
  const actionId = input.features.elicitation ? input.actionId : undefined
  const client = new Client(
    { name: 'hookfish-mcp-inspector', version: '0.0.0' },
    {
      capabilities: actionId
        ? { elicitation: { form: {}, url: {} } }
        : undefined,
      versionNegotiation: { mode: 'auto' },
    },
  )
  if (actionId) {
    client.setRequestHandler('elicitation/create', ({ params }) =>
      waitForElicitation(actionId, params),
    )
    client.setNotificationHandler(
      'notifications/elicitation/complete',
      ({ params }) => completeUrlElicitation(actionId, params.elicitationId),
    )
  }
  return client
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
  const token = await accessToken(origin, input.connectionPath)
  const streamableClient = createClient(input)

  try {
    await streamableClient.connect(
      new StreamableHTTPClientTransport(url, clientOptions(token)),
    )
    return { client: streamableClient, transport: 'Streamable HTTP' }
  } catch (streamableError) {
    await streamableClient.close().catch(() => undefined)
    if (isAuthenticationError(streamableError)) {
      const action = input.connectionPath ? 'Reconnect' : 'Connect'
      throw new Error(
        `Authentication required. Use ${action} to authorize this Streamable HTTP server with Hookfish.`,
      )
    }
    const sseClient = createClient(input)
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

const interactiveRequestOptions = {
  timeout: 15 * 60 * 1000,
  maxTotalTimeout: 15 * 60 * 1000,
}

async function withElicitation<T>(
  actionId: string,
  operation: () => Promise<T>,
) {
  beginElicitationOperation(actionId)
  try {
    return await operation()
  } finally {
    finishElicitationOperation(actionId)
  }
}

async function withUrlElicitation<T>(
  actionId: string,
  operation: () => Promise<T>,
) {
  for (let round = 0; round < 10; round += 1) {
    try {
      return await operation()
    } catch (error) {
      if (!(error instanceof UrlElicitationRequiredError)) throw error
      for (const elicitation of error.elicitations) {
        const result = await waitForElicitation(actionId, elicitation)
        if (result.action !== 'accept') {
          throw new Error(
            result.action === 'decline'
              ? 'URL elicitation was declined.'
              : 'URL elicitation was cancelled.',
          )
        }
      }
    }
  }
  throw new Error('The server requested too many URL elicitation rounds.')
}

export async function inspectServer(input: ConnectionInput, origin: string) {
  return withClient(input, origin, async ({ client, transport }) => {
    const capabilities = client.getServerCapabilities() ?? {}
    const [tools, resources, resourceTemplates, prompts] = await Promise.all([
      input.features.tools && capabilities.tools ? listAllTools(client) : [],
      input.features.resources && capabilities.resources
        ? listAllResources(client)
        : [],
      input.features.resources && capabilities.resources
        ? listAllResourceTemplates(client)
        : [],
      input.features.prompts && capabilities.prompts
        ? listAllPrompts(client)
        : [],
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
    actionId: string
    name: string
    arguments: Record<string, unknown>
  },
  origin: string,
) {
  if (!input.features.tools) throw new Error('Tools are disabled.')
  const operation = () =>
    withClient(input, origin, async ({ client }) => {
      await client.listTools()
      const callTool = () =>
        client.callTool(
          { name: input.name, arguments: input.arguments },
          interactiveRequestOptions,
        )
      return input.features.elicitation
        ? withUrlElicitation(input.actionId, callTool)
        : callTool()
    })
  return input.features.elicitation
    ? withElicitation(input.actionId, operation)
    : operation()
}

export async function readResource(
  input: ConnectionInput & { actionId: string; uri: string },
  origin: string,
) {
  if (!input.features.resources) throw new Error('Resources are disabled.')
  const operation = () =>
    withClient(input, origin, ({ client }) => {
      const read = () =>
        client.readResource({ uri: input.uri }, interactiveRequestOptions)
      return input.features.elicitation
        ? withUrlElicitation(input.actionId, read)
        : read()
    })
  return input.features.elicitation
    ? withElicitation(input.actionId, operation)
    : operation()
}

export async function renderPrompt(
  input: ConnectionInput & {
    actionId: string
    name: string
    arguments: Record<string, string>
  },
  origin: string,
) {
  if (!input.features.prompts) throw new Error('Prompts are disabled.')
  const operation = () =>
    withClient(input, origin, ({ client }) => {
      const getPrompt = () =>
        client.getPrompt(
          { name: input.name, arguments: input.arguments },
          interactiveRequestOptions,
        )
      return input.features.elicitation
        ? withUrlElicitation(input.actionId, getPrompt)
        : getPrompt()
    })
  return input.features.elicitation
    ? withElicitation(input.actionId, operation)
    : operation()
}

export async function authorizeServer(
  input: { url: string; label: string },
  origin: string,
) {
  const hash = createHash('sha256')
    .update(`${origin}\0${input.url}`)
    .digest('hex')
    .slice(0, 16)
  const connectionPath = `inspector/${hash}/mcp`

  const returnTo = new URL('/', origin)
  returnTo.searchParams.set('oauth', 'complete')
  const response = await handleHookfishRequest(
    new Request(
      new URL(`/api/connections/reauthorize/${connectionPath}`, origin),
      {
        headers: {
          Authorization: `Bearer ${apiKey()}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
        body: JSON.stringify({
          url: input.url,
          scopes: [],
          return_to: returnTo.toString(),
        }),
      },
    ),
  )
  const payload: unknown = await response.json().catch(() => undefined)
  const authorization = authorizationRequiredSchema.safeParse(payload)
  if (response.status !== 401 || !authorization.success) {
    const error = hookfishErrorSchema.safeParse(payload)
    throw new Error(
      error.success
        ? error.data.error.message
        : `Hookfish returned HTTP ${response.status}.`,
    )
  }

  return {
    connection_path: connectionPath,
    authorize_url: authorization.data.error.authorize_url,
  }
}
