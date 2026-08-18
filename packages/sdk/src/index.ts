import {
  Client as McpClient,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import { Octokit } from 'octokit'
import packageJson from '../package.json' with { type: 'json' }
import {
  type Client as ApiClient,
  type Config,
  createClient,
} from './generated/client/index.js'
import {
  adminTokensCreate,
  adminTokensList,
  adminTokensRevoke,
  connectionsAccess,
  connectionsAuthorize,
  connectionsDisconnect,
  connectionsGet,
  connectionsList,
  connectionsProviders,
  connectionsSetSecret,
  statsGet,
} from './generated/index.js'

export * from './generated/index.js'

type MaybePromise<T> = T | Promise<T>
type ApiKey = string | (() => MaybePromise<string>)

export type HookfishOptions = Pick<Config, 'baseUrl' | 'fetch' | 'headers'> & {
  /** Root or scoped Hookfish broker credential. */
  apiKey: ApiKey
}

type ErrorDetails = {
  code?: unknown
  message?: unknown
  authorize_url?: unknown
  expires_at?: unknown
}

function errorEnvelope(body: unknown): ErrorDetails | undefined {
  if (typeof body !== 'object' || body === null || !('error' in body)) {
    return undefined
  }
  const error = body.error
  if (typeof error !== 'object' || error === null) return undefined
  return {
    code: 'code' in error ? error.code : undefined,
    message: 'message' in error ? error.message : undefined,
    authorize_url: 'authorize_url' in error ? error.authorize_url : undefined,
    expires_at: 'expires_at' in error ? error.expires_at : undefined,
  }
}

export class HookfishError extends Error {
  readonly status: number | undefined
  readonly code: string | undefined
  readonly authorizeUrl: string | undefined
  readonly expiresAt: string | undefined
  readonly body: unknown
  private readonly response: Response | undefined

  constructor(response: Response | undefined, body: unknown) {
    const error = errorEnvelope(body)
    super(
      typeof error?.message === 'string'
        ? error.message
        : `Hookfish request failed${response ? ` (${response.status})` : ''}.`,
    )
    this.name = 'HookfishError'
    this.status = response?.status
    this.code = typeof error?.code === 'string' ? error.code : undefined
    this.authorizeUrl =
      typeof error?.authorize_url === 'string' ? error.authorize_url : undefined
    this.expiresAt =
      typeof error?.expires_at === 'string' ? error.expires_at : undefined
    this.body = body
    this.response = response
  }

  /** Return the failed HTTP response for Hono and other response-aware hosts. */
  getResponse(): Response {
    const headers = new Headers(this.response?.headers)
    headers.delete('content-encoding')
    headers.delete('content-length')

    const body =
      this.response === undefined
        ? this.message
        : typeof this.body === 'string'
          ? this.body
          : (JSON.stringify(this.body) ?? this.message)

    return new Response(body, {
      status: this.status ?? 500,
      statusText: this.response?.statusText,
      headers,
    })
  }
}

export type ConnectionAccessInput = {
  /** Provider-specific, non-secret connection configuration. */
  configuration?: Record<string, unknown>
  scopes?: string[]
  returnTo?: string
}

export type ConnectionFilter = {
  namespace?: string
  providerId?: string
}

export type McpProviderInput = Omit<ConnectionAccessInput, 'configuration'> & {
  /** Canonical Hookfish connection path ending in `/mcp`. */
  connection: string
  /** Streamable HTTP MCP resource URL. */
  url: string | URL
  /** An unconnected MCP client to use instead of the Hookfish default. */
  client?: McpClient
}

export type McpProviderClient = McpClient & {
  [Symbol.asyncDispose](): Promise<void>
}

export type GitHubProviderInput = Omit<
  ConnectionAccessInput,
  'configuration'
> & {
  /** Canonical Hookfish connection path ending in `/github`. */
  connection: string
}

type AccessTokenInput = Parameters<typeof adminTokensCreate>[0]

/**
 * Unwraps the response body every method resolves to. The generated signatures
 * hard-code the client's default `'fields'` style, so requests are made in that
 * style and unwrapped here; asking the client for `responseStyle: 'data'`
 * instead would leave the declared type describing an envelope that never
 * arrives.
 */
async function data<T>(result: Promise<{ data: T }>): Promise<T> {
  return (await result).data
}

function withAsyncDispose(client: McpClient): McpProviderClient {
  return Object.assign(client, {
    [Symbol.asyncDispose]: () => client.close(),
  })
}

/** End-to-end typed client for a Hookfish broker. */
export class Hookfish {
  private readonly client: ApiClient

  constructor(options: HookfishOptions) {
    const { apiKey, ...clientOptions } = options
    this.client = createClient({
      ...clientOptions,
      auth: typeof apiKey === 'function' ? () => apiKey() : apiKey,
    })
    this.client.interceptors.error.use(
      (body, response) => new HookfishError(response, body),
    )
  }

  private readonly requestOptions = () => ({
    client: this.client,
    throwOnError: true as const,
  })

  readonly connections = {
    access: (path: string, input: ConnectionAccessInput = {}) => {
      const options = this.requestOptions()
      const parameters = {
        connection_path: path,
        configuration: input.configuration,
        scopes: input.scopes,
        return_to: input.returnTo,
      }
      return data(connectionsAccess(parameters, options))
    },
    authorize: (path: string, input: ConnectionAccessInput = {}) => {
      const options = this.requestOptions()
      const parameters = {
        connection_path: path,
        configuration: input.configuration,
        scopes: input.scopes,
        return_to: input.returnTo,
      }
      return data(connectionsAuthorize(parameters, options))
    },
    setSecret: (path: string, secret: string) => {
      const options = this.requestOptions()
      return data(
        connectionsSetSecret({ connection_path: path, secret }, options),
      )
    },
    list: (filter: ConnectionFilter = {}) => {
      const options = this.requestOptions()
      const parameters = {
        namespace: filter.namespace,
        provider_id: filter.providerId,
      }
      return data(connectionsList(parameters, options))
    },
    get: (path: string) => {
      const options = this.requestOptions()
      return data(connectionsGet({ connection_path: path }, options))
    },
    disconnect: (path: string) => {
      const options = this.requestOptions()
      return data(connectionsDisconnect({ connection_path: path }, options))
    },
    providers: () => {
      const options = this.requestOptions()
      return data(connectionsProviders(options))
    },
  }

  readonly provider = {
    github: async (input: GitHubProviderInput): Promise<Octokit> => {
      const { secret } = await this.connections.access(input.connection, {
        scopes: input.scopes,
        returnTo: input.returnTo,
      })
      return new Octokit({ auth: secret })
    },
    mcp: async (input: McpProviderInput): Promise<McpProviderClient> => {
      const resourceUrl = new URL(input.url)
      const connectionInput: ConnectionAccessInput = {
        configuration: { resource_url: resourceUrl.href },
        scopes: input.scopes,
        returnTo: input.returnTo,
      }
      const mcp = withAsyncDispose(
        input.client ??
          new McpClient(
            { name: packageJson.name, version: packageJson.version },
            { versionNegotiation: { mode: 'auto' } },
          ),
      )

      try {
        await mcp.connect(
          new StreamableHTTPClientTransport(resourceUrl, {
            authProvider: {
              token: async () =>
                (
                  await this.connections.access(
                    input.connection,
                    connectionInput,
                  )
                ).secret,
              onUnauthorized: async () => {
                await this.connections.authorize(
                  input.connection,
                  connectionInput,
                )
              },
            },
          }),
        )
        return mcp
      } catch (error) {
        await mcp.close().catch(() => undefined)
        throw error
      }
    },
  }

  /** Create an authenticated Octokit client for a GitHub connection. */
  readonly github = (
    connection: string,
    input: Omit<ConnectionAccessInput, 'configuration'> = {},
  ): Promise<Octokit> => this.provider.github({ connection, ...input })

  /** Create a connected MCP client for a remote server. */
  readonly mcp = (input: McpProviderInput): Promise<McpProviderClient> =>
    this.provider.mcp(input)

  readonly accessTokens = {
    list: () => data(adminTokensList(this.requestOptions())),
    create: (input: AccessTokenInput) =>
      data(adminTokensCreate(input, this.requestOptions())),
    revoke: (name: string) =>
      data(adminTokensRevoke({ name }, this.requestOptions())),
  }

  readonly stats = () => data(statsGet(this.requestOptions()))
}
