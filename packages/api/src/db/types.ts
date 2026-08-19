export type DatabaseResult<T> = T | PromiseLike<T>

export type Connection = {
  id: string
  namespace: string
  providerId: string
  configuration: Record<string, unknown>
  oauthIssuer: string | null
  oauthClientId: string | null
  oauthClientSecret: string | null
  secret: string | null
  refreshToken: string | null
  tokenType: string
  requestedScopes: string[]
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
  namespace: string
  providerId: string
  codeVerifier: string | null
  redirectUri: string
  returnTo: string | null
  scopes: string[]
  issuer: string | null
  status: string
  errorStatus: number | null
  errorCode: string | null
  errorMessage: string | null
  completedAt: Date | null
  createdAt: Date
  expiresAt: Date
}

export type AccessGrant = {
  id: string
  parentGrantId: string | null
  scopes: string[]
  createdAt: Date
  expiresAt: Date
}

export type BrokerAccessToken = {
  name: string
  tokenIdHash: string
  grantId: string
  createdAt: Date
  grant: AccessGrant
}

export type NewOAuthState = Pick<
  OAuthState,
  'id' | 'namespace' | 'providerId' | 'redirectUri' | 'scopes' | 'expiresAt'
> &
  Partial<Pick<OAuthState, 'codeVerifier' | 'returnTo' | 'issuer' | 'status'>>

export type OAuthStateUpdate = Partial<
  Pick<
    OAuthState,
    'status' | 'errorStatus' | 'errorCode' | 'errorMessage' | 'completedAt'
  >
>

export type NewConnection = Pick<
  Connection,
  'namespace' | 'providerId' | 'configuration'
> &
  Partial<
    Pick<
      Connection,
      | 'oauthIssuer'
      | 'oauthClientId'
      | 'oauthClientSecret'
      | 'secret'
      | 'refreshToken'
      | 'tokenType'
      | 'requestedScopes'
      | 'scopes'
      | 'expiresAt'
      | 'metadata'
      | 'externalAccountId'
      | 'externalAccountLabel'
    >
  >

export type ConnectionUpdate = Partial<
  Pick<
    Connection,
    | 'configuration'
    | 'oauthIssuer'
    | 'oauthClientId'
    | 'oauthClientSecret'
    | 'secret'
    | 'refreshToken'
    | 'tokenType'
    | 'requestedScopes'
    | 'scopes'
    | 'expiresAt'
    | 'metadata'
    | 'externalAccountId'
    | 'externalAccountLabel'
  >
>

export type ConnectionSummary = Pick<
  Connection,
  | 'namespace'
  | 'providerId'
  | 'configuration'
  | 'scopes'
  | 'expiresAt'
  | 'externalAccountId'
  | 'externalAccountLabel'
  | 'metadata'
  | 'createdAt'
  | 'updatedAt'
>

export type ConnectionFilter = {
  providerId?: string
  namespace?: string
  resourceScopes?: string[]
}

export type NewBrokerAccessToken = Pick<
  BrokerAccessToken,
  'name' | 'tokenIdHash' | 'grantId'
> & {
  parentGrantId: string | null
  scopes: string[]
  expiresAt: Date
}

/** Persistence contract shared by Postgres, PGlite, and Durable Objects. */
export interface Database {
  createOAuthState(input: NewOAuthState): DatabaseResult<void>
  supersedeOAuthStates(
    namespace: string,
    providerId: string,
  ): DatabaseResult<void>
  claimOAuthState(
    ids: readonly string[],
    providerId: string,
  ): DatabaseResult<OAuthState | undefined>
  getOAuthState(
    ids: readonly string[],
    providerId: string,
  ): DatabaseResult<OAuthState | undefined>
  updateOAuthState(
    id: string,
    update: OAuthStateUpdate,
  ): DatabaseResult<OAuthState | undefined>
  purgeExpiredOAuthStates(before: Date): DatabaseResult<number>

  getConnection(
    namespace: string,
    providerId: string,
  ): DatabaseResult<Connection | undefined>
  putConnection(input: NewConnection): DatabaseResult<Connection>
  updateConnection(
    id: string,
    update: ConnectionUpdate,
  ): DatabaseResult<Connection | undefined>
  /**
   * Atomically claim the refresh lease for a connection. Bundled adapters
   * implement this so refreshes coordinate across processes and instances.
   */
  acquireConnectionRefreshLock?(
    id: string,
    owner: string,
    leaseDurationMs: number,
  ): DatabaseResult<boolean>
  /** Extend a lease only when it is still owned by this caller. */
  renewConnectionRefreshLock?(
    id: string,
    owner: string,
    leaseDurationMs: number,
  ): DatabaseResult<boolean>
  /** Release a refresh lease only when it is still owned by this caller. */
  releaseConnectionRefreshLock?(id: string, owner: string): DatabaseResult<void>
  listConnections(
    filter?: ConnectionFilter,
  ): DatabaseResult<ConnectionSummary[]>
  deleteConnection(id: string): DatabaseResult<boolean>

  getValidBrokerAccessToken(
    tokenIdHash: string,
    grantId: string,
    now: Date,
  ): DatabaseResult<BrokerAccessToken | undefined>
  purgeExpiredBrokerAccessTokens(before: Date): DatabaseResult<void>
  createBrokerAccessToken(input: NewBrokerAccessToken): DatabaseResult<boolean>
  listBrokerAccessTokenNames(): DatabaseResult<string[]>
  deleteBrokerAccessTokenGrant(name: string): DatabaseResult<boolean>
}
