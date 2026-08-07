/**
 * DESIGN STUB — not yet wired into the broker. See `docs/credential-provider.md`.
 *
 * `CredentialProvider` generalizes {@link OAuthProvider} so Hookfish can broker
 * more than a fixed set of hand-written OAuth integrations: remote MCP servers
 * that speak the MCP authorization spec (discovery + dynamic client
 * registration) and servers that authenticate with a pasted API key / header.
 *
 * The generalization rests on two orthogonal axes rather than a type hierarchy:
 *
 * - `acquisition` — how the secret is obtained. Every method ends the same way:
 *   the user visits a URL and a secret eventually arrives at the callback.
 * - `apply` — how the gateway presents the stored secret downstream. This is
 *   what "header-based auth" actually is.
 *
 * A pasted token applied as `Authorization: Bearer` and an OAuth token applied
 * the same way share their `apply`; they differ only in `acquisition`.
 */

import type {
  AuthorizationRequest,
  CreateAuthorizationInput,
  ExchangeCodeInput,
  ProviderTokenResponse,
  RefreshTokenInput,
  RevokeTokenInput,
} from './index'

/** How the secret is obtained. */
export type CredentialAcquisition =
  /** Standard OAuth: redirect to consent, redeem the returned `code`. */
  | 'oauth'
  /** MCP authorization spec: discover the auth server + register a client, then behave like `oauth`. */
  | 'mcp-oauth'
  /** User pastes a token into a Hookfish-hosted form; the pasted value is the "code". */
  | 'paste'

/** How the gateway presents the stored secret to the downstream server. */
export type CredentialApplication =
  /** The OAuth default. */
  | { in: 'header'; name: 'Authorization'; scheme: 'Bearer' }
  /** A custom header such as `X-API-Key`. `scheme` prefixes the value when present. */
  | { in: 'header'; name: string; scheme?: string }
  /** A query parameter. */
  | { in: 'query'; name: string }

/**
 * The broker coordinates these lifecycle operations and never needs to know a
 * provider's OAuth dialect, discovery mechanics, or header conventions.
 *
 * `OAuthProvider` is the `acquisition: 'oauth'`, Bearer-`apply` specialization
 * of this contract; existing providers adopt it via defaults.
 */
export interface CredentialProvider {
  readonly acquisition: CredentialAcquisition
  readonly apply: CredentialApplication
  readonly label?: string
  readonly defaultScopes?: readonly string[]
  readonly availableScopes?: readonly string[]
  readonly usesPkce?: boolean
  isConfigured?(): boolean

  /**
   * Step 1 — the URL the user visits.
   *
   * - `oauth` / `mcp-oauth`: an external consent URL (+ optional PKCE verifier).
   * - `paste`: an internal "paste your token" form URL.
   */
  createAuthorization(
    input: CreateAuthorizationInput,
  ): AuthorizationRequest | Promise<AuthorizationRequest>

  /**
   * Step 2 — turn what came back into a storable secret.
   *
   * - `oauth` / `mcp-oauth`: exchange `input.code` at the token endpoint.
   * - `paste`: `input.code` *is* the secret; optionally probe it before storing.
   */
  exchangeCode(input: ExchangeCodeInput): Promise<ProviderTokenResponse>

  /** Only meaningful for the OAuth acquisition kinds. */
  refreshToken?(input: RefreshTokenInput): Promise<ProviderTokenResponse>
  revokeToken?(input: RevokeTokenInput): Promise<void>
}

/** Arbitrary non-secret JSON persisted on a provider definition. */
export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json }

/**
 * A persisted catalog entry. The `driver` names a compiled {@link CredentialDriver};
 * `config` carries only non-secret data (server URL, `apply` descriptor,
 * discovered endpoints, DCR `client_id`). A client secret, when present, lives in
 * encrypted storage and is surfaced through {@link ProviderStore} out of band.
 */
export interface ProviderDefinition {
  slug: string
  driver: string
  config: Record<string, Json>
  /** Tenant scoping, mirroring `oauth_connections.organization`. */
  organization?: string
  /** Whether an encrypted client secret exists for this slug. */
  hasSecret?: boolean
  createdAt: Date
  updatedAt: Date
}

/**
 * Persistence port for the catalog. Backed by the same database binding the rest
 * of the broker uses, so it composes with the request-aware `DatabaseInput`.
 */
export interface ProviderStore {
  get(
    slug: string,
    organization?: string,
  ): Promise<ProviderDefinition | undefined>
  /** Powers `GET /providers`. */
  list(organization?: string): Promise<ProviderDefinition[]>
  upsert(definition: ProviderDefinition): Promise<void>
  delete(slug: string, organization?: string): Promise<void>
}

/**
 * Materializes a concrete provider from a stored definition. `secret` is the
 * decrypted client secret when {@link ProviderDefinition.hasSecret} is set.
 */
export type CredentialDriver = (
  definition: ProviderDefinition,
  secret?: string,
) => CredentialProvider

/**
 * The small, in-memory set of driver classes compiled into the app
 * (`mcp-oauth`, `paste`, and the bespoke vendor providers). Definitions are data
 * in {@link ProviderStore}; drivers are code registered here.
 */
export class DriverRegistry {
  private readonly drivers = new Map<string, CredentialDriver>()

  constructor(drivers: Record<string, CredentialDriver> = {}) {
    for (const [name, driver] of Object.entries(drivers)) {
      this.drivers.set(name, driver)
    }
  }

  register(name: string, driver: CredentialDriver): void {
    this.drivers.set(name, driver)
  }

  /** Materialize a provider from a definition, or `undefined` if no driver matches. */
  materialize(
    definition: ProviderDefinition,
    secret?: string,
  ): CredentialProvider | undefined {
    return this.drivers.get(definition.driver)?.(definition, secret)
  }

  has(name: string): boolean {
    return this.drivers.has(name)
  }
}
