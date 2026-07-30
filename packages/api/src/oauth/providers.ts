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
  /** Google/GitHub use spaces; Linear uses commas. */
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
    scopeSeparator: ',',
    tokenRequestFormat: 'form',
    clientAuth: 'body',
    usePkce: false,
    supportsRefresh: true,
  },

  google: {
    id: 'google',
    label: 'Google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    defaultScopes: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/drive.readonly',
    ],
    scopeSeparator: ' ',
    tokenRequestFormat: 'form',
    clientAuth: 'body',
    usePkce: true,
    supportsRefresh: true,
    // `offline` + `consent` are required to actually receive a refresh token;
    // without them Google only returns one on the very first authorization.
    authorizeParams: { access_type: 'offline', prompt: 'consent' },
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
