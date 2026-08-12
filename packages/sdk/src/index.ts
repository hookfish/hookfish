import {
  adminProvidersDelete,
  adminProvidersGet,
  adminProvidersList,
  adminProvidersPatch,
  adminProvidersPut,
  adminTokensCreate,
  adminTokensList,
  adminTokensRevoke,
  oauthAuthorize,
  oauthConnectionsDisconnect,
  oauthConnectionsGet,
  oauthConnectionsList,
  oauthProvidersList,
  oauthTokensGet,
  organizationAdminProvidersDelete,
  organizationAdminProvidersGet,
  organizationAdminProvidersList,
  organizationAdminProvidersPatch,
  organizationAdminProvidersPut,
  organizationOauthAuthorize,
  organizationOauthConnectionsDisconnect,
  organizationOauthConnectionsGet,
  organizationOauthConnectionsList,
  organizationOauthProvidersList,
  organizationOauthTokensGet,
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

export class HookfishError extends Error {
  readonly status: number | undefined
  readonly code: string | undefined
  readonly body: unknown

  constructor(response: Response | undefined, body: unknown) {
    const message =
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'object' &&
      body.error !== null &&
      'message' in body.error &&
      typeof body.error.message === 'string'
        ? body.error.message
        : `Hookfish request failed${response ? ` (${response.status})` : ''}.`
    super(message)
    this.name = 'HookfishError'
    this.status = response?.status
    this.code =
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'object' &&
      body.error !== null &&
      'code' in body.error &&
      typeof body.error.code === 'string'
        ? body.error.code
        : undefined
    this.body = body
  }
}

type ProviderPutInput = Omit<
  Parameters<typeof adminProvidersPut>[0],
  'provider_path'
>
type ProviderPatchInput = Omit<
  Parameters<typeof adminProvidersPatch>[0],
  'provider_path'
>
type AuthorizeInput = {
  connectionId?: string
  connectionIdPrefix?: string
  scopes?: string[]
  returnTo?: string
}
type AccessTokenInput = Parameters<typeof adminTokensCreate>[0]
type ProviderFilter = Parameters<typeof oauthProvidersList>[0]
type ConnectionFilter = Parameters<typeof oauthConnectionsList>[0]
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

  readonly providers = {
    list: () => {
      const options = this.requestOptions()
      return this.organization
        ? organizationAdminProvidersList(
            { organization: this.organization },
            options,
          )
        : adminProvidersList(options)
    },
    get: (provider: string) => {
      const options = this.requestOptions()
      return this.organization
        ? organizationAdminProvidersGet(
            { organization: this.organization, provider_path: provider },
            options,
          )
        : adminProvidersGet({ provider_path: provider }, options)
    },
    put: (provider: string, input: ProviderPutInput) => {
      const options = this.requestOptions()
      return this.organization
        ? organizationAdminProvidersPut(
            {
              ...input,
              organization: this.organization,
              provider_path: provider,
            },
            options,
          )
        : adminProvidersPut({ ...input, provider_path: provider }, options)
    },
    patch: (provider: string, input: ProviderPatchInput) => {
      const options = this.requestOptions()
      return this.organization
        ? organizationAdminProvidersPatch(
            {
              ...input,
              organization: this.organization,
              provider_path: provider,
            },
            options,
          )
        : adminProvidersPatch({ ...input, provider_path: provider }, options)
    },
    delete: (provider: string) => {
      const options = this.requestOptions()
      return this.organization
        ? organizationAdminProvidersDelete(
            { organization: this.organization, provider_path: provider },
            options,
          )
        : adminProvidersDelete({ provider_path: provider }, options)
    },
  }

  readonly oauth = {
    providers: (filter?: ProviderFilter) => {
      const options = this.requestOptions()
      return this.organization
        ? organizationOauthProvidersList(
            { ...filter, organization: this.organization },
            options,
          )
        : oauthProvidersList(filter, options)
    },
    authorize: (provider: string, input: AuthorizeInput = {}) => {
      const options = this.requestOptions()
      const parameters = {
        connection_id: input.connectionId,
        connection_id_prefix: input.connectionIdPrefix,
        scopes: input.scopes,
        return_to: input.returnTo,
        provider_path: provider,
      }
      return this.organization
        ? organizationOauthAuthorize(
            {
              ...parameters,
              organization: this.organization,
            },
            options,
          )
        : oauthAuthorize(parameters, options)
    },
    getToken: (connectionId: string) => {
      const options = this.requestOptions()
      return this.organization
        ? organizationOauthTokensGet(
            {
              organization: this.organization,
              connection_id: connectionId,
            },
            options,
          )
        : oauthTokensGet({ connection_id: connectionId }, options)
    },
  }

  readonly connections = {
    list: (filter?: ConnectionFilter) => {
      const options = this.requestOptions()
      return this.organization
        ? organizationOauthConnectionsList(
            { ...filter, organization: this.organization },
            options,
          )
        : oauthConnectionsList(filter, options)
    },
    get: (connectionId: string) => {
      const options = this.requestOptions()
      return this.organization
        ? organizationOauthConnectionsGet(
            {
              organization: this.organization,
              connection_id: connectionId,
            },
            options,
          )
        : oauthConnectionsGet({ connection_id: connectionId }, options)
    },
    disconnect: (connectionId: string) => {
      const options = this.requestOptions()
      return this.organization
        ? organizationOauthConnectionsDisconnect(
            {
              organization: this.organization,
              connection_id: connectionId,
            },
            options,
          )
        : oauthConnectionsDisconnect({ connection_id: connectionId }, options)
    },
  }

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
