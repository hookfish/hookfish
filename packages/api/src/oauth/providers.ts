import { z } from '@hono/zod-openapi'

/**
 * Everything the broker needs to know about a provider that is *not* a secret.
 * Credentials come from the environment (see `config.ts`); this file is just
 * the shape of each provider's OAuth dialect.
 *
 * To add a provider, append an entry to `providerRegistry` and set
 * `<ID>_CLIENT_ID` / `<ID>_CLIENT_SECRET` in the environment. Nothing else in
 * the codebase needs to change.
 */
export type ProviderDefinition = {
  id: string
  label: string
  authorizeUrl: string
  tokenUrl: string
  /** Applied when `<ID>_SCOPES` is not set in the environment. */
  defaultScopes: string[]
  /** Scopes a client may offer for per-authorization selection. */
  availableScopes: string[]
  /** GitHub uses spaces; Linear uses commas. */
  scopeSeparator: string
  /** How the token endpoint wants the request encoded. */
  tokenRequestFormat: 'form' | 'json'
  /** Basic-auth header vs. client_id/client_secret in the body. */
  clientAuth: 'basic' | 'body'
  /** Whether to run the PKCE S256 challenge. */
  usePkce: boolean
  /** Whether the provider issues refresh tokens worth attempting to use. */
  supportsRefresh: boolean
  /** Static params appended to the authorize URL. */
  authorizeParams?: Record<string, string>
  /** Pulls a stable account identity out of the raw token response. */
  describeAccount?: (payload: Record<string, unknown>) => {
    id?: string
    label?: string
  }
}

const stringField = z.string().optional().catch(undefined)

/** Notion returns the workspace inline with the token. */
function describeNotionAccount(payload: Record<string, unknown>) {
  return {
    id: stringField.parse(payload.workspace_id),
    label: stringField.parse(payload.workspace_name),
  }
}

export const providerRegistry: Record<string, ProviderDefinition> = {
  notion: {
    id: 'notion',
    label: 'Notion',
    authorizeUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    // Notion has no scope parameter -- access is chosen by the user in the
    // consent UI when they pick which pages to share.
    defaultScopes: [],
    availableScopes: [],
    scopeSeparator: ' ',
    tokenRequestFormat: 'json',
    clientAuth: 'basic',
    usePkce: false,
    // Classic Notion integration tokens do not expire and have no refresh.
    supportsRefresh: false,
    authorizeParams: { owner: 'user' },
    describeAccount: describeNotionAccount,
  },

  linear: {
    id: 'linear',
    label: 'Linear',
    authorizeUrl: 'https://linear.app/oauth/authorize',
    tokenUrl: 'https://api.linear.app/oauth/token',
    defaultScopes: ['read', 'write'],
    availableScopes: ['read', 'write'],
    scopeSeparator: ',',
    tokenRequestFormat: 'form',
    clientAuth: 'body',
    usePkce: false,
    supportsRefresh: true,
  },

  github: {
    id: 'github',
    label: 'GitHub',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    // No scope grants read-only access to public profile, repository, and
    // gist information. Callers can opt into additional access per flow.
    defaultScopes: [],
    availableScopes: [
      'repo',
      'repo:status',
      'repo_deployment',
      'public_repo',
      'repo:invite',
      'security_events',
      'admin:repo_hook',
      'write:repo_hook',
      'read:repo_hook',
      'admin:org',
      'write:org',
      'read:org',
      'admin:public_key',
      'write:public_key',
      'read:public_key',
      'admin:org_hook',
      'gist',
      'notifications',
      'user',
      'read:user',
      'user:email',
      'user:follow',
      'project',
      'read:project',
      'delete_repo',
      'write:packages',
      'read:packages',
      'delete:packages',
      'admin:gpg_key',
      'write:gpg_key',
      'read:gpg_key',
      'codespace',
      'workflow',
      'read:audit_log',
    ],
    scopeSeparator: ' ',
    tokenRequestFormat: 'form',
    clientAuth: 'body',
    // GitHub supports PKCE but does not require it. This broker is a
    // confidential server-side client and authenticates the token exchange
    // with its client secret, while `state` protects the callback from CSRF.
    usePkce: false,
    // GitHub OAuth App tokens do not expire or issue refresh tokens.
    supportsRefresh: false,
  },
}

export function getProviderDefinition(
  providerId: string,
): ProviderDefinition | undefined {
  return providerRegistry[providerId]
}

export function listProviderIds(): string[] {
  return Object.keys(providerRegistry)
}

/** Built-in providers cannot be replaced or removed via `registerProvider`. */
const builtinProviderIds = new Set(listProviderIds())

/**
 * Register a provider at runtime. Used by integration tests to point a
 * throwaway provider at a local OAuth stub. Built-in ids are reserved.
 */
export function registerProvider(definition: ProviderDefinition): void {
  if (builtinProviderIds.has(definition.id)) {
    throw new Error(
      `Cannot replace built-in provider "${definition.id}". Pick a different id.`,
    )
  }

  providerRegistry[definition.id] = definition
}

/** Remove a provider previously added with `registerProvider`. */
export function unregisterProvider(providerId: string): void {
  if (builtinProviderIds.has(providerId)) {
    throw new Error(`Cannot unregister built-in provider "${providerId}".`)
  }

  delete providerRegistry[providerId]
}
