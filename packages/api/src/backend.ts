import type { ApplicationPrincipal } from './application-auth.js'
import type { AccessGrant } from './oauth/access-token.js'

export type MaybePromise<T> = T | Promise<T>

/** Context Hookfish has authenticated before delegating to a managed backend. */
export type HookfishBackendContext<Bindings extends object = object> = {
  request: Request
  bindings: Bindings
  accessGrant: AccessGrant
  /** Present for requests authenticated through Hookfish's application facade. */
  principal?: ApplicationPrincipal
}

export type HookfishBackendProvider = {
  id: string
  label: string
  /** Managed backends are OAuth-only; static credentials stay self-hosted. */
  authentication: 'oauth'
  inputSchema?: {
    fields: Array<{
      name: string
      label: string
      type: 'text' | 'url' | 'string_list'
      target: 'identity' | 'configuration' | 'scopes'
      required: boolean
      placeholder?: string
      description?: string
    }>
  }
}

export type HookfishBackendConnection = {
  path: string
  namespace: string
  providerId: string
  configuration?: Record<string, unknown>
  scopes?: string[]
  expiresAt?: Date | string | null
  externalAccountId?: string | null
  externalAccountLabel?: string | null
  metadata?: Record<string, unknown>
  createdAt?: Date | string
  updatedAt?: Date | string
}

export type HookfishBackendConnectionInput = {
  path: string
  namespace: string
  providerId: string
  configuration?: Record<string, unknown>
  scopes?: string[]
  returnTo?: string
}

export type HookfishBackendAuthorizationRequired = {
  status: 'authorization_required'
  authorizeUrl: string
  expiresAt: Date | string
}

export type HookfishBackendAccessResult =
  | HookfishBackendAuthorizationRequired
  | {
      status: 'connected'
      secret: string
      scopes?: string[]
      expiresAt?: Date | string | null
      refreshed?: boolean
    }

export type HookfishBackendDisconnectResult = {
  deleted: boolean
  revocation?: 'revoked' | 'unsupported'
}

export type HookfishBackendAdapter<Bindings extends object = object> = {
  listProviders(
    context: HookfishBackendContext<Bindings>,
    query: URLSearchParams,
  ): MaybePromise<{ providers: HookfishBackendProvider[] }>
  listConnections(
    context: HookfishBackendContext<Bindings>,
    filter: { namespace?: string; providerId?: string },
  ): MaybePromise<HookfishBackendConnection[]>
  getConnection(
    context: HookfishBackendContext<Bindings>,
    input: Pick<
      HookfishBackendConnectionInput,
      'path' | 'namespace' | 'providerId'
    >,
  ): MaybePromise<HookfishBackendConnection | undefined>
  access(
    context: HookfishBackendContext<Bindings>,
    input: HookfishBackendConnectionInput,
  ): MaybePromise<HookfishBackendAccessResult>
  authorize(
    context: HookfishBackendContext<Bindings>,
    input: HookfishBackendConnectionInput,
  ): MaybePromise<HookfishBackendAuthorizationRequired>
  disconnect(
    context: HookfishBackendContext<Bindings>,
    input: Pick<
      HookfishBackendConnectionInput,
      'path' | 'namespace' | 'providerId'
    >,
  ): MaybePromise<HookfishBackendDisconnectResult>
}

/**
 * A managed OAuth backend for Hookfish.
 *
 * The adapter deliberately has no static-secret write operation. Providers
 * such as Arcade can own OAuth connections and token refresh without becoming
 * a general-purpose secret store.
 */
export class HookfishBackend<Bindings extends object = object> {
  readonly supportsStaticSecrets = false
  readonly adapter: HookfishBackendAdapter<Bindings>

  constructor(adapter: HookfishBackendAdapter<Bindings>) {
    this.adapter = adapter
  }
}
