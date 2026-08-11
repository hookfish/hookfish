export type DatabaseResult<T> = T | PromiseLike<T>

export type OAuthConnection = {
  id: string
  organization: string | null
  connectionId: string
  provider: string
  accessToken: string
  refreshToken: string | null
  tokenType: string
  scopes: string[]
  expiresAt: Date | null
  metadata: Record<string, unknown>
  externalAccountId: string | null
  externalAccountLabel: string | null
  createdAt: Date
  updatedAt: Date
}

export type OAuthState = {
  id: string
  connectionId: string
  organization: string | null
  provider: string
  codeVerifier: string | null
  redirectUri: string
  returnTo: string | null
  scopes: string[]
  status: string
  errorStatus: number | null
  errorCode: string | null
  errorMessage: string | null
  completedAt: Date | null
  createdAt: Date
  expiresAt: Date
}

export type BrokerAccessToken = {
  name: string
  tokenIdHash: string
  scopes: string[]
  createdAt: Date
  expiresAt: Date
}

export type OAuthProviderRecord = {
  id: string
  organization: string
  providerId: string
  templateId: string
  label: string | null
  credentialMode: string
  clientId: string | null
  clientSecretPath: string | null
  configuration: Record<string, unknown>
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

export type VaultSecret = {
  id: string
  organization: string
  path: string
  value: string
  createdAt: Date
  updatedAt: Date
}

export type NewOAuthState = Pick<
  OAuthState,
  'id' | 'connectionId' | 'provider' | 'redirectUri' | 'scopes' | 'expiresAt'
> &
  Partial<
    Pick<OAuthState, 'organization' | 'codeVerifier' | 'returnTo' | 'status'>
  >

export type OAuthStateUpdate = Partial<
  Pick<
    OAuthState,
    'status' | 'errorStatus' | 'errorCode' | 'errorMessage' | 'completedAt'
  >
>

export type NewOAuthConnection = Omit<
  OAuthConnection,
  'id' | 'createdAt' | 'updatedAt'
>

export type OAuthConnectionTokenUpdate = Pick<
  OAuthConnection,
  | 'accessToken'
  | 'refreshToken'
  | 'tokenType'
  | 'scopes'
  | 'expiresAt'
  | 'metadata'
  | 'externalAccountId'
  | 'externalAccountLabel'
>

export type OAuthConnectionSummary = Pick<
  OAuthConnection,
  | 'connectionId'
  | 'provider'
  | 'scopes'
  | 'expiresAt'
  | 'externalAccountId'
  | 'externalAccountLabel'
  | 'metadata'
  | 'createdAt'
  | 'updatedAt'
>

export type OAuthConnectionFilter = {
  organization?: string
  provider?: string
  connectionIdPrefix?: string
  connectionScopes?: string[]
}

export type NewOAuthProviderRecord = Omit<
  OAuthProviderRecord,
  'id' | 'createdAt' | 'updatedAt'
>

export type OAuthProviderUpdate = Partial<
  Pick<
    OAuthProviderRecord,
    | 'templateId'
    | 'label'
    | 'credentialMode'
    | 'clientId'
    | 'clientSecretPath'
    | 'configuration'
    | 'enabled'
  >
>

export type OAuthProviderFilter = {
  organization: string
  search?: string
  limit?: number
}

export type NewVaultSecret = Pick<
  VaultSecret,
  'organization' | 'path' | 'value'
>

export type VaultSecretFilter = {
  organization: string
  prefix?: string
  scopes?: string[]
  excludeInternalPrefix?: string
}

export type VaultSecretMetadata = Pick<
  VaultSecret,
  'path' | 'createdAt' | 'updatedAt'
>

export type NewBrokerAccessToken = Pick<
  BrokerAccessToken,
  'name' | 'tokenIdHash' | 'scopes' | 'expiresAt'
>

/**
 * The persistence contract used by Hookfish business logic.
 *
 * Implementations may be local databases or remote, request-scoped handles
 * such as Durable Object RPC stubs. Methods return awaitable values so both
 * ordinary promises and Workers RPC thenables are accepted.
 */
export interface Database {
  createOAuthState(input: NewOAuthState): DatabaseResult<void>
  claimOAuthState(
    ids: readonly string[],
    provider: string,
  ): DatabaseResult<OAuthState | undefined>
  getOAuthState(
    ids: readonly string[],
    provider: string,
  ): DatabaseResult<OAuthState | undefined>
  updateOAuthState(
    id: string,
    update: OAuthStateUpdate,
  ): DatabaseResult<OAuthState | undefined>
  purgeExpiredOAuthStates(before: Date): DatabaseResult<number>

  getOAuthConnection(
    connectionId: string,
    organization?: string,
  ): DatabaseResult<OAuthConnection | undefined>
  upsertOAuthConnection(
    input: NewOAuthConnection,
  ): DatabaseResult<OAuthConnection | undefined>
  updateOAuthConnectionTokens(
    id: string,
    update: OAuthConnectionTokenUpdate,
  ): DatabaseResult<OAuthConnection | undefined>
  listOAuthConnections(
    filter?: OAuthConnectionFilter,
  ): DatabaseResult<OAuthConnectionSummary[]>
  deleteOAuthConnection(id: string): DatabaseResult<boolean>
  hasOAuthConnectionForProvider(
    providerId: string,
    organization?: string,
  ): DatabaseResult<boolean>

  getOAuthProvider(
    organization: string,
    providerId: string,
  ): DatabaseResult<OAuthProviderRecord | undefined>
  listOAuthProviders(
    filter: OAuthProviderFilter,
  ): DatabaseResult<OAuthProviderRecord[]>
  putOAuthProvider(
    input: NewOAuthProviderRecord,
  ): DatabaseResult<OAuthProviderRecord>
  updateOAuthProvider(
    id: string,
    update: OAuthProviderUpdate,
  ): DatabaseResult<OAuthProviderRecord | undefined>
  deleteOAuthProviderIfUnused(
    id: string,
    providerId: string,
    organization?: string,
  ): DatabaseResult<'deleted' | 'not_found' | 'in_use'>

  putVaultSecret(input: NewVaultSecret): DatabaseResult<VaultSecret>
  getVaultSecret(
    organization: string,
    path: string,
  ): DatabaseResult<VaultSecret | undefined>
  listVaultSecrets(
    filter: VaultSecretFilter,
  ): DatabaseResult<VaultSecretMetadata[]>
  deleteVaultSecret(organization: string, path: string): DatabaseResult<boolean>

  getValidBrokerAccessToken(
    name: string,
    tokenIdHash: string,
    now: Date,
  ): DatabaseResult<BrokerAccessToken | undefined>
  purgeExpiredBrokerAccessTokens(before: Date): DatabaseResult<void>
  createBrokerAccessToken(input: NewBrokerAccessToken): DatabaseResult<boolean>
  listBrokerAccessTokenNames(): DatabaseResult<string[]>
  deleteBrokerAccessToken(name: string): DatabaseResult<boolean>
}
