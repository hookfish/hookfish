import { isOAuthProviderTemplate, type OAuthProvider } from '@hookfish/provider'
import type { Database, OAuthProviderRecord } from '../db/types'
import type { BoundProviderSource } from '../provider-source'
import { getVaultSecret, organizationKey } from '../vault'
import { type ProviderConfig, resolveProviderConfig } from './config'
import { BrokerError } from './errors'
import { normalizeResourcePath } from './resource-path'

export const PROVIDER_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function normalizeProviderTemplateId(providerId: string): string {
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

/** Provider configurations live in the same slash-delimited namespace as connections. */
export function normalizeProviderId(providerId: string): string {
  return normalizeResourcePath(providerId, 'provider')
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
  return db.getOAuthProvider(organizationKey(organization), providerId)
}

export async function listDynamicProviders(
  db: Database,
  organization?: string,
): Promise<OAuthProviderRecord[]> {
  return db.listOAuthProviders({
    organization: organizationKey(organization),
  })
}

async function instantiateDynamicProvider(
  db: Database,
  env: object,
  record: OAuthProviderRecord,
  providers: BoundProviderSource,
): Promise<OAuthProvider> {
  const template = await providers.getProvider(record.templateId)
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
  providers: BoundProviderSource,
  organization?: string,
  options: { forNewAuthorization?: boolean } = {},
): Promise<ProviderConfig> {
  normalizeProviderId(providerId)
  const fixed = await providers.getProvider(providerId)
  if (fixed) return resolveProviderConfig(providerId, fixed)

  const record = await findDynamicProvider(db, providerId, organization)
  if (!record) {
    throw new BrokerError(
      404,
      'unknown_provider',
      `Unknown provider "${providerId}".`,
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

export type ProviderDescriptorFilter = {
  configured?: boolean
  limit?: number
  search?: string
  source?: 'fixed' | 'dynamic'
}

export type ProviderDescriptorListResult = {
  providers: ProviderDescriptor[]
  [key: string]: unknown
}

export async function listProviderDescriptorPage(
  db: Database,
  env: object,
  providers: BoundProviderSource,
  organization?: string,
  filter: ProviderDescriptorFilter = {},
  query = new URLSearchParams(),
): Promise<ProviderDescriptorListResult> {
  const search = filter.search?.trim().toLowerCase()
  const sourceResult =
    filter.source === 'dynamic'
      ? { providers: [] }
      : await providers.listProviders(query)
  const { providers: sourceProviders, ...listingMetadata } = sourceResult
  const fixed: ProviderDescriptor[] = sourceProviders
    .filter(
      ({ id, provider }) =>
        !search ||
        id.toLowerCase().includes(search) ||
        provider.label?.toLowerCase().includes(search),
    )
    .map(({ id, provider }) => ({
      id,
      label: provider.label ?? id,
      configured: provider.isConfigured?.() ?? true,
      enabled: true,
      source: 'fixed',
      provider,
    }))
  let dynamicRecords: OAuthProviderRecord[] = []
  if (filter.source !== 'fixed') {
    dynamicRecords = await db.listOAuthProviders({
      organization: organizationKey(organization),
      search,
      limit:
        filter.limit && filter.configured === undefined
          ? filter.limit
          : undefined,
    })
  }
  const dynamic = await Promise.all(
    dynamicRecords.map(async (record): Promise<ProviderDescriptor> => {
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
    }),
  )
  const descriptors = [...fixed, ...dynamic].sort(
    (left, right) =>
      left.label.localeCompare(right.label) || left.id.localeCompare(right.id),
  )
  const filteredDescriptors =
    filter.configured === undefined
      ? descriptors
      : descriptors.filter(
          (descriptor) => descriptor.configured === filter.configured,
        )
  return {
    ...listingMetadata,
    providers: filter.limit
      ? filteredDescriptors.slice(0, filter.limit)
      : filteredDescriptors,
  }
}

export async function listProviderDescriptors(
  db: Database,
  env: object,
  providers: BoundProviderSource,
  organization?: string,
  filter: ProviderDescriptorFilter = {},
): Promise<ProviderDescriptor[]> {
  return (
    await listProviderDescriptorPage(db, env, providers, organization, filter)
  ).providers
}
