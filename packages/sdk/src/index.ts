import {
  type Client,
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

/** End-to-end typed client for a Hookfish broker. */
export class Hookfish {
  private readonly client: Client

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

  readonly accessTokens = {
    list: () => data(adminTokensList(this.requestOptions())),
    create: (input: AccessTokenInput) =>
      data(adminTokensCreate(input, this.requestOptions())),
    revoke: (name: string) =>
      data(adminTokensRevoke({ name }, this.requestOptions())),
  }

  readonly stats = () => data(statsGet(this.requestOptions()))
}
