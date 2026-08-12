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
  organizationConnectionsAccess,
  organizationConnectionsAuthorize,
  organizationConnectionsDisconnect,
  organizationConnectionsGet,
  organizationConnectionsList,
  organizationConnectionsProviders,
  organizationConnectionsSetSecret,
  organizationSecretsDelete,
  organizationSecretsGet,
  organizationSecretsList,
  organizationSecretsPut,
  secretsDelete,
  secretsGet,
  secretsList,
  secretsPut,
  statsGet,
} from './generated'
import { type Client, type Config, createClient } from './generated/client'

export * from './generated'

type MaybePromise<T> = T | Promise<T>
type ApiKey = string | (() => MaybePromise<string>)

export type HookfishOptions = Pick<Config, 'baseUrl' | 'fetch' | 'headers'> & {
  /** Root or scoped Hookfish broker credential. */
  apiKey: ApiKey
  /** Route all supported resources through this organization namespace. */
  organization?: string
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
type SecretFilter = Parameters<typeof secretsList>[0]

/** End-to-end typed client for a Hookfish broker. */
export class Hookfish {
  readonly organization: string | undefined
  private readonly client: Client

  constructor(options: HookfishOptions) {
    const { apiKey, organization, ...clientOptions } = options
    this.organization = organization
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
    responseStyle: 'data' as const,
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
      return this.organization
        ? organizationConnectionsAccess(
            { ...parameters, organization: this.organization },
            options,
          )
        : connectionsAccess(parameters, options)
    },
    authorize: (path: string, input: ConnectionAccessInput = {}) => {
      const options = this.requestOptions()
      const parameters = {
        connection_path: path,
        configuration: input.configuration,
        scopes: input.scopes,
        return_to: input.returnTo,
      }
      return this.organization
        ? organizationConnectionsAuthorize(
            { ...parameters, organization: this.organization },
            options,
          )
        : connectionsAuthorize(parameters, options)
    },
    setSecret: (path: string, secret: string) => {
      const options = this.requestOptions()
      return this.organization
        ? organizationConnectionsSetSecret(
            {
              organization: this.organization,
              connection_path: path,
              secret,
            },
            options,
          )
        : connectionsSetSecret({ connection_path: path, secret }, options)
    },
    list: (filter: ConnectionFilter = {}) => {
      const options = this.requestOptions()
      const parameters = {
        namespace: filter.namespace,
        provider_id: filter.providerId,
      }
      return this.organization
        ? organizationConnectionsList(
            { ...parameters, organization: this.organization },
            options,
          )
        : connectionsList(parameters, options)
    },
    get: (path: string) => {
      const options = this.requestOptions()
      return this.organization
        ? organizationConnectionsGet(
            { organization: this.organization, connection_path: path },
            options,
          )
        : connectionsGet({ connection_path: path }, options)
    },
    disconnect: (path: string) => {
      const options = this.requestOptions()
      return this.organization
        ? organizationConnectionsDisconnect(
            { organization: this.organization, connection_path: path },
            options,
          )
        : connectionsDisconnect({ connection_path: path }, options)
    },
    providers: () => {
      const options = this.requestOptions()
      return this.organization
        ? organizationConnectionsProviders(
            { organization: this.organization },
            options,
          )
        : connectionsProviders(options)
    },
  }

  /** Generic vault secrets, separate from provider-backed connections. */
  readonly secrets = {
    list: (filter?: SecretFilter) => {
      const options = this.requestOptions()
      return this.organization
        ? organizationSecretsList(
            { ...filter, organization: this.organization },
            options,
          )
        : secretsList(filter, options)
    },
    get: (path: string) => {
      const options = this.requestOptions()
      return this.organization
        ? organizationSecretsGet(
            { organization: this.organization, secret_path: path },
            options,
          )
        : secretsGet({ secret_path: path }, options)
    },
    put: (path: string, value: string) => {
      const options = this.requestOptions()
      return this.organization
        ? organizationSecretsPut(
            { organization: this.organization, secret_path: path, value },
            options,
          )
        : secretsPut({ secret_path: path, value }, options)
    },
    delete: (path: string) => {
      const options = this.requestOptions()
      return this.organization
        ? organizationSecretsDelete(
            { organization: this.organization, secret_path: path },
            options,
          )
        : secretsDelete({ secret_path: path }, options)
    },
  }

  readonly accessTokens = {
    list: () => adminTokensList(this.requestOptions()),
    create: (input: AccessTokenInput) =>
      adminTokensCreate(input, this.requestOptions()),
    revoke: (name: string) =>
      adminTokensRevoke({ name }, this.requestOptions()),
  }

  readonly stats = () => statsGet(this.requestOptions())
}
