import {
  isOAuthProviderTemplate,
  type OAuthProvider,
  type ProviderRegistry,
} from '@hookfish/provider'
import { and, asc, eq } from 'drizzle-orm'
import type { Database, OAuthProviderRecord } from '../db/schema'
import { oauthProviders } from '../db/schema'
import { getVaultSecret, organizationKey } from '../vault'
import { type ProviderConfig, resolveProviderConfig } from './config'
import { BrokerError } from './errors'

export const PROVIDER_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function normalizeProviderId(providerId: string): string {
  const normalized = providerId.trim()
  if (!PROVIDER_ID_PATTERN.test(normalized) || normalized.length > 128) {
    throw new BrokerError(
      400,
      'invalid_provider_id',
      'Provider id must be 1-128 lowercase letters, numbers, or hyphen-separated segments.',
    )
  }
  return normalized
}

export function normalizeProviderLabel(label?: string): string | undefined {
  if (label === undefined) return undefined
  const normalized = label.trim()
  if (!normalized || normalized.length > 128) {
    throw new BrokerError(
      400,
      'invalid_provider_label',
      'Provider label must be 1-128 characters.',
    )
  }
  return normalized
}

export async function findDynamicProvider(
  db: Database,
  providerId: string,
  organization?: string,
): Promise<OAuthProviderRecord | undefined> {
  const [record] = await db
    .select()
    .from(oauthProviders)
    .where(
      and(
        eq(oauthProviders.organization, organizationKey(organization)),
        eq(oauthProviders.providerId, providerId),
      ),
    )
    .limit(1)
  return record
}

export async function listDynamicProviders(
  db: Database,
  organization?: string,
): Promise<OAuthProviderRecord[]> {
  return db
    .select()
    .from(oauthProviders)
    .where(eq(oauthProviders.organization, organizationKey(organization)))
    .orderBy(asc(oauthProviders.providerId))
}

async function instantiateDynamicProvider(
  db: Database,
  env: object,
  record: OAuthProviderRecord,
  providers: ProviderRegistry,
): Promise<OAuthProvider> {
  const template = providers.getProvider(record.templateId)
  if (!template || !isOAuthProviderTemplate(template)) {
    throw new BrokerError(
      500,
      'missing_provider_template',
      `Dynamic provider "${record.providerId}" requires template "${record.templateId}", but that fixed provider is not registered as a template.`,
    )
  }

  if (record.credentialMode === 'inherit') {
    return template.createProvider(undefined, record.configuration)
  }
  if (record.credentialMode !== 'custom' || !record.clientId) {
    throw new BrokerError(
      500,
      'invalid_provider_credentials',
      `Dynamic provider "${record.providerId}" has an invalid credential configuration.`,
    )
  }

  let clientSecret: string | undefined
  if (record.clientSecretPath) {
    try {
      const secret = await getVaultSecret(
        db,
        env,
        record.clientSecretPath,
        record.organization || undefined,
        true,
      )
      clientSecret = secret.value
    } catch (error) {
      if (error instanceof BrokerError && error.code === 'secret_not_found') {
        throw new BrokerError(
          500,
          'missing_provider_credentials',
          `Dynamic provider "${record.providerId}" is missing its stored client secret.`,
        )
      }
      throw error
    }
  }
  if (!clientSecret && !template.allowsPublicClient) {
    throw new BrokerError(
      500,
      'missing_provider_credentials',
      `Dynamic provider "${record.providerId}" requires a stored client secret.`,
    )
  }
  return template.createProvider(
    {
      clientId: record.clientId,
      clientSecret: clientSecret ?? '',
    },
    record.configuration,
  )
}

export async function resolveRequestProviderConfig(
  db: Database,
  env: object,
  providerId: string,
  providers: ProviderRegistry,
  organization?: string,
  options: { forNewAuthorization?: boolean } = {},
): Promise<ProviderConfig> {
  const fixed = providers.getProvider(providerId)
  if (fixed) return resolveProviderConfig(providerId, providers)

  const record = await findDynamicProvider(db, providerId, organization)
  if (!record) {
    const dynamicIds = (await listDynamicProviders(db, organization)).map(
      ({ providerId: id }) => id,
    )
    const known = [...providers.listProviderIds(), ...dynamicIds]
    throw new BrokerError(
      404,
      'unknown_provider',
      `Unknown provider "${providerId}". Known providers: ${known.join(', ')}.`,
    )
  }
  if (options.forNewAuthorization && !record.enabled) {
    throw new BrokerError(
      409,
      'provider_disabled',
      `Provider "${providerId}" is disabled for new authorizations.`,
    )
  }

  const provider = await instantiateDynamicProvider(db, env, record, providers)
  return { provider, scopes: [...(provider.defaultScopes ?? [])] }
}

export type ProviderDescriptor = {
  id: string
  label: string
  configured: boolean
  enabled: boolean
  source: 'fixed' | 'dynamic'
  templateId?: string
  credentialMode?: 'inherit' | 'custom'
  configuration?: Record<string, unknown>
  provider?: OAuthProvider
}

export async function listProviderDescriptors(
  db: Database,
  env: object,
  providers: ProviderRegistry,
  organization?: string,
): Promise<ProviderDescriptor[]> {
  const fixed: ProviderDescriptor[] = providers
    .listProviders()
    .map(([id, provider]) => ({
      id,
      label: provider.label ?? id,
      configured: providers.isProviderConfigured(id),
      enabled: true,
      source: 'fixed',
      provider,
    }))
  const dynamic = await Promise.all(
    (await listDynamicProviders(db, organization)).map(
      async (record): Promise<ProviderDescriptor> => {
        try {
          const provider = await instantiateDynamicProvider(
            db,
            env,
            record,
            providers,
          )
          return {
            id: record.providerId,
            label: record.label ?? provider.label ?? record.providerId,
            configured: record.enabled && (provider.isConfigured?.() ?? true),
            enabled: record.enabled,
            source: 'dynamic',
            templateId: record.templateId,
            credentialMode:
              record.credentialMode === 'custom' ? 'custom' : 'inherit',
            configuration: record.configuration,
            provider,
          }
        } catch {
          return {
            id: record.providerId,
            label: record.label ?? record.providerId,
            configured: false,
            enabled: record.enabled,
            source: 'dynamic',
            templateId: record.templateId,
            credentialMode:
              record.credentialMode === 'custom' ? 'custom' : 'inherit',
            configuration: record.configuration,
          }
        }
      },
    ),
  )
  return [...fixed, ...dynamic]
}
