import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import {
  isOAuthProviderTemplate,
  ProviderConfigurationError,
  ProviderRequestError,
  type OAuthProviderTemplate,
  type ProviderConfiguration,
  type ProviderRegistry,
} from '@hookfish/provider'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { createMiddleware } from 'hono/factory'
import type { DatabaseInput } from '../db/binding'
import { oauthConnections, oauthProviders } from '../db/schema'
import { emitHookfishEvent, type HookfishEventHandler } from '../events'
import { assertRootAccess } from '../oauth/access-token'
import { resolveBrokerConfig, resolveRedirectUri } from '../oauth/config'
import {
  findDynamicProvider,
  listProviderDescriptors,
  normalizeProviderId,
  normalizeProviderLabel,
  PROVIDER_ID_PATTERN,
} from '../oauth/dynamic-provider'
import { BrokerError, isBrokerError } from '../oauth/errors'
import {
  type BrokerContext,
  requireApiKey,
  withDatabase,
} from '../oauth/middleware'
import { ORGANIZATION_PATTERN } from '../oauth/organization'
import {
  deleteVaultSecret,
  organizationKey,
  providerClientSecretPath,
  putVaultSecret,
} from '../vault'

const brokerAuth = [{ brokerApiKey: [] }]

const providerIdParam = z.object({
  provider_id: z.string().min(1).max(128).regex(PROVIDER_ID_PATTERN),
})

const inheritedCredentials = z.object({ mode: z.literal('inherit') })
const customCredentials = z.object({
  mode: z.literal('custom'),
  client_id: z.string().trim().min(1).max(512),
  client_secret: z.string().min(1).max(65_536).optional(),
})
const registeredCredentials = z.object({ mode: z.literal('register') })
const credentialsSchema = z.discriminatedUnion('mode', [
  inheritedCredentials,
  customCredentials,
  registeredCredentials,
])
const configurationSchema = z.record(z.string(), z.unknown())

const providerResponseSchema = z.object({
  id: z.string(),
  template: z.string().nullable(),
  label: z.string(),
  source: z.enum(['fixed', 'dynamic']),
  configured: z.boolean(),
  enabled: z.boolean(),
  credentials: z
    .object({
      mode: z.enum(['inherit', 'custom']),
      client_id: z.string().nullable(),
    })
    .nullable(),
  configuration: configurationSchema.nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
})

const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
})
const errors = {
  400: {
    description: 'Invalid provider configuration',
    content: { 'application/json': { schema: errorSchema } },
  },
  401: {
    description: 'Missing or invalid broker credential',
    content: { 'application/json': { schema: errorSchema } },
  },
  403: {
    description: 'Root broker access is required',
    content: { 'application/json': { schema: errorSchema } },
  },
  404: {
    description: 'Provider not found',
    content: { 'application/json': { schema: errorSchema } },
  },
  409: {
    description: 'Provider id is reserved or still in use',
    content: { 'application/json': { schema: errorSchema } },
  },
  500: {
    description: 'Broker configuration error',
    content: { 'application/json': { schema: errorSchema } },
  },
  502: {
    description: 'Upstream provider request failed',
    content: { 'application/json': { schema: errorSchema } },
  },
}

const listRoute = createRoute({
  method: 'get',
  path: '/providers',
  summary: 'List fixed and dynamic providers',
  security: brokerAuth,
  responses: {
    200: {
      description: 'Provider configurations',
      content: {
        'application/json': {
          schema: z.object({ providers: z.array(providerResponseSchema) }),
        },
      },
    },
    ...errors,
  },
})

const getRoute = createRoute({
  method: 'get',
  path: '/providers/{provider_id}',
  summary: 'Get a provider configuration',
  security: brokerAuth,
  request: { params: providerIdParam },
  responses: {
    200: {
      description: 'Provider configuration',
      content: {
        'application/json': {
          schema: z.object({ provider: providerResponseSchema }),
        },
      },
    },
    ...errors,
  },
})

const putRoute = createRoute({
  method: 'put',
  path: '/providers/{provider_id}',
  summary: 'Create or replace a dynamic provider',
  description:
    'Custom client secrets are encrypted and write-only. Inherited credentials use the complete credential pair from the fixed provider template.',
  security: brokerAuth,
  request: {
    params: providerIdParam,
    body: {
      content: {
        'application/json': {
          schema: z.object({
            template: z.string().min(1).max(128).regex(PROVIDER_ID_PATTERN),
            label: z.string().trim().min(1).max(128).optional(),
            configuration: configurationSchema.optional(),
            credentials: credentialsSchema,
            enabled: z.boolean().optional().default(true),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Provider stored',
      content: {
        'application/json': {
          schema: z.object({ provider: providerResponseSchema }),
        },
      },
    },
    ...errors,
  },
})

const patchRoute = createRoute({
  method: 'patch',
  path: '/providers/{provider_id}',
  summary: 'Update a dynamic provider',
  security: brokerAuth,
  request: {
    params: providerIdParam,
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              template: z
                .string()
                .min(1)
                .max(128)
                .regex(PROVIDER_ID_PATTERN)
                .optional(),
              label: z.string().trim().min(1).max(128).nullable().optional(),
              configuration: configurationSchema.optional(),
              credentials: credentialsSchema.optional(),
              enabled: z.boolean().optional(),
            })
            .refine((body) => Object.keys(body).length > 0, {
              message: 'Provide at least one provider field to update.',
            }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Provider updated',
      content: {
        'application/json': {
          schema: z.object({ provider: providerResponseSchema }),
        },
      },
    },
    ...errors,
  },
})

const deleteRoute = createRoute({
  method: 'delete',
  path: '/providers/{provider_id}',
  summary: 'Delete an unused dynamic provider',
  description:
    'Returns 409 while an OAuth connection references the provider. Disable it to block new authorizations while retaining refresh and revocation.',
  security: brokerAuth,
  request: { params: providerIdParam },
  responses: {
    200: {
      description: 'Deletion result',
      content: {
        'application/json': {
          schema: z.object({ id: z.string(), deleted: z.boolean() }),
        },
      },
    },
    ...errors,
  },
})

type ProviderRouteOptions = {
  enabled: boolean
  organizationRouting?: boolean
  routeMode: 'global' | 'organization'
  onEvent?: HookfishEventHandler
}

function requestOrganization(
  request: { param(name: string): string | undefined },
  options: ProviderRouteOptions,
): string | undefined {
  if (options.routeMode === 'global') return undefined
  if (!options.organizationRouting) {
    throw new BrokerError(
      404,
      'organization_routing_disabled',
      'Organization-prefixed provider routes are disabled.',
    )
  }
  const organization = request.param('organization')
  if (!organization || !ORGANIZATION_PATTERN.test(organization)) {
    throw new BrokerError(
      400,
      'invalid_organization',
      'Organization must be 1-128 characters using letters, numbers, dots, underscores, or hyphens.',
    )
  }
  return organization
}

function requireTemplate(providers: ProviderRegistry, templateId: string) {
  const template = providers.getProvider(templateId)
  if (!template || !isOAuthProviderTemplate(template)) {
    throw new BrokerError(
      400,
      'invalid_provider_template',
      `Fixed provider "${templateId}" is not registered as a reusable provider template.`,
    )
  }
  return template
}

function normalizeConfiguration(
  template: OAuthProviderTemplate,
  configuration: ProviderConfiguration = {},
): ProviderConfiguration {
  try {
    return template.normalizeConfiguration?.(configuration) ?? configuration
  } catch (error) {
    if (error instanceof ProviderConfigurationError) {
      throw new BrokerError(
        400,
        'invalid_provider_configuration',
        error.message,
      )
    }
    throw error
  }
}

async function resolveCredentials(
  template: OAuthProviderTemplate,
  credentials:
    | z.infer<typeof inheritedCredentials>
    | z.infer<typeof customCredentials>
    | z.infer<typeof registeredCredentials>,
  configuration: ProviderConfiguration,
  redirectUri: string,
): Promise<
  | {
      mode: 'inherit'
    }
  | {
      mode: 'custom'
      credentials: { clientId: string; clientSecret?: string }
    }
> {
  if (credentials.mode === 'inherit') {
    return { mode: 'inherit' }
  }

  if (credentials.mode === 'custom') {
    if (!credentials.client_secret && !template.allowsPublicClient) {
      throw new BrokerError(
        400,
        'missing_client_secret',
        'This provider requires a client secret.',
      )
    }
    return {
      mode: 'custom',
      credentials: {
        clientId: credentials.client_id,
        clientSecret: credentials.client_secret,
      },
    }
  }

  if (!template.registerClient) {
    throw new BrokerError(
      400,
      'registration_unsupported',
      'This provider does not support automatic client registration.',
    )
  }

  try {
    return {
      mode: 'custom',
      credentials: await template.registerClient({
        configuration,
        redirectUri,
      }),
    }
  } catch (error) {
    if (error instanceof ProviderConfigurationError) {
      throw new BrokerError(
        400,
        'client_registration_unavailable',
        error.message,
      )
    }
    if (error instanceof ProviderRequestError) {
      throw new BrokerError(502, 'client_registration_failed', error.message)
    }
    throw error
  }
}

function serializeProvider(
  descriptor: Awaited<ReturnType<typeof listProviderDescriptors>>[number],
  record?: Awaited<ReturnType<typeof findDynamicProvider>>,
) {
  return {
    id: descriptor.id,
    template: descriptor.templateId ?? null,
    label: descriptor.label,
    source: descriptor.source,
    configured: descriptor.configured,
    enabled: descriptor.enabled,
    credentials:
      descriptor.source === 'dynamic'
        ? {
            mode: descriptor.credentialMode ?? 'inherit',
            client_id: record?.clientId ?? null,
          }
        : null,
    configuration:
      descriptor.source === 'dynamic' ? (descriptor.configuration ?? {}) : null,
    created_at: record?.createdAt.toISOString() ?? null,
    updated_at: record?.updatedAt.toISOString() ?? null,
  }
}

export function createProviderRoutes<Bindings extends object>(
  resolveProviders: (bindings: Bindings) => Promise<ProviderRegistry>,
  database: DatabaseInput<Bindings>,
  options: ProviderRouteOptions,
) {
  const routes = new OpenAPIHono<BrokerContext<Bindings>>()
  const authenticate = requireApiKey<Bindings>()
  const connectDatabase = withDatabase(database, (request) => ({
    organization: requestOrganization(request, options),
  }))
  const requireEnabled = createMiddleware<BrokerContext<Bindings>>(
    async (_context, next) => {
      if (!options.enabled) {
        throw new BrokerError(
          404,
          'provider_management_disabled',
          'Dynamic provider management is disabled.',
        )
      }
      await next()
    },
  )
  routes.use('/providers', requireEnabled, connectDatabase, authenticate)
  routes.use('/providers/*', requireEnabled, connectDatabase, authenticate)

  const listApi = routes.openapi(listRoute, async (c) => {
    assertRootAccess(c.get('accessGrant'))
    const { organization } = c.get('databaseContext')
    const providers = await resolveProviders(c.env)
    const descriptors = await listProviderDescriptors(
      c.get('db'),
      resolveBrokerConfig(c.env),
      providers,
      organization,
    )
    const records = await Promise.all(
      descriptors.map(({ id, source }) =>
        source === 'dynamic'
          ? findDynamicProvider(c.get('db'), id, organization)
          : undefined,
      ),
    )
    return c.json(
      {
        providers: descriptors.map((descriptor, index) =>
          serializeProvider(descriptor, records[index]),
        ),
      },
      200,
    )
  })

  const getApi = listApi.openapi(getRoute, async (c) => {
    assertRootAccess(c.get('accessGrant'))
    const providerId = normalizeProviderId(c.req.valid('param').provider_id)
    const { organization } = c.get('databaseContext')
    const providers = await resolveProviders(c.env)
    const descriptor = (
      await listProviderDescriptors(
        c.get('db'),
        resolveBrokerConfig(c.env),
        providers,
        organization,
      )
    ).find(({ id }) => id === providerId)
    if (!descriptor) {
      throw new BrokerError(
        404,
        'unknown_provider',
        `Unknown provider "${providerId}".`,
      )
    }
    const record =
      descriptor.source === 'dynamic'
        ? await findDynamicProvider(c.get('db'), providerId, organization)
        : undefined
    return c.json({ provider: serializeProvider(descriptor, record) }, 200)
  })

  const putApi = getApi.openapi(putRoute, async (c) => {
    assertRootAccess(c.get('accessGrant'))
    const providerId = normalizeProviderId(c.req.valid('param').provider_id)
    const providers = await resolveProviders(c.env)
    if (providers.getProvider(providerId)) {
      throw new BrokerError(
        409,
        'fixed_provider_id',
        `Provider id "${providerId}" is reserved by a fixed provider.`,
      )
    }
    const body = c.req.valid('json')
    const templateId = normalizeProviderId(body.template)
    const template = requireTemplate(providers, templateId)
    const configuration = normalizeConfiguration(
      template,
      body.configuration ?? {},
    )
    const resolvedCredentials = await resolveCredentials(
      template,
      body.credentials,
      configuration,
      resolveRedirectUri(resolveBrokerConfig(c.env), c.req.url, providerId),
    )
    const { organization } = c.get('databaseContext')
    const existing = await findDynamicProvider(
      c.get('db'),
      providerId,
      organization,
    )
    const secretPath = providerClientSecretPath(providerId)
    if (
      resolvedCredentials.mode === 'custom' &&
      resolvedCredentials.credentials.clientSecret
    ) {
      await putVaultSecret(
        c.get('db'),
        resolveBrokerConfig(c.env),
        secretPath,
        resolvedCredentials.credentials.clientSecret,
        organization,
        true,
      )
    }
    const [record] = await c
      .get('db')
      .insert(oauthProviders)
      .values({
        organization: organizationKey(organization),
        providerId,
        templateId,
        label: normalizeProviderLabel(body.label),
        credentialMode: resolvedCredentials.mode,
        clientId:
          resolvedCredentials.mode === 'custom'
            ? resolvedCredentials.credentials.clientId
            : null,
        clientSecretPath:
          resolvedCredentials.mode === 'custom' &&
          resolvedCredentials.credentials.clientSecret
            ? secretPath
            : null,
        configuration,
        enabled: body.enabled,
      })
      .onConflictDoUpdate({
        target: [oauthProviders.organization, oauthProviders.providerId],
        set: {
          templateId,
          label: normalizeProviderLabel(body.label) ?? null,
          credentialMode: resolvedCredentials.mode,
          clientId:
            resolvedCredentials.mode === 'custom'
              ? resolvedCredentials.credentials.clientId
              : null,
          clientSecretPath:
            resolvedCredentials.mode === 'custom' &&
            resolvedCredentials.credentials.clientSecret
              ? secretPath
              : null,
          configuration,
          enabled: body.enabled,
          updatedAt: new Date(),
        },
      })
      .returning()
    if (
      existing?.clientSecretPath &&
      (resolvedCredentials.mode === 'inherit' ||
        !resolvedCredentials.credentials.clientSecret)
    ) {
      await deleteVaultSecret(
        c.get('db'),
        existing.clientSecretPath,
        organization,
        true,
      )
    }
    const descriptor = (
      await listProviderDescriptors(
        c.get('db'),
        resolveBrokerConfig(c.env),
        providers,
        organization,
      )
    ).find(({ id }) => id === providerId)!
    await emitHookfishEvent(options.onEvent, {
      type: existing ? 'provider.updated' : 'provider.created',
      occurredAt: new Date(),
      organization,
      provider: providerId,
    })
    return c.json({ provider: serializeProvider(descriptor, record) }, 200)
  })

  const patchApi = putApi.openapi(patchRoute, async (c) => {
    assertRootAccess(c.get('accessGrant'))
    const providerId = normalizeProviderId(c.req.valid('param').provider_id)
    const { organization } = c.get('databaseContext')
    const providers = await resolveProviders(c.env)
    const existing = await findDynamicProvider(
      c.get('db'),
      providerId,
      organization,
    )
    if (!existing) {
      throw new BrokerError(
        404,
        'unknown_provider',
        `Unknown dynamic provider "${providerId}".`,
      )
    }
    const body = c.req.valid('json')
    const templateId = body.template
      ? normalizeProviderId(body.template)
      : existing.templateId
    const template = requireTemplate(providers, templateId)
    const configuration = normalizeConfiguration(
      template,
      body.configuration ?? existing.configuration,
    )
    const resolvedCredentials = body.credentials
      ? await resolveCredentials(
          template,
          body.credentials,
          configuration,
          resolveRedirectUri(resolveBrokerConfig(c.env), c.req.url, providerId),
        )
      : undefined
    const credentialMode =
      resolvedCredentials?.mode ??
      (existing.credentialMode === 'custom' ? 'custom' : 'inherit')
    const secretPath = providerClientSecretPath(providerId)
    if (
      resolvedCredentials?.mode === 'custom' &&
      resolvedCredentials.credentials.clientSecret
    ) {
      await putVaultSecret(
        c.get('db'),
        resolveBrokerConfig(c.env),
        secretPath,
        resolvedCredentials.credentials.clientSecret,
        organization,
        true,
      )
    }
    const [record] = await c
      .get('db')
      .update(oauthProviders)
      .set({
        templateId,
        label:
          body.label === undefined
            ? existing.label
            : (normalizeProviderLabel(body.label ?? undefined) ?? null),
        credentialMode,
        clientId:
          resolvedCredentials?.mode === 'custom'
            ? resolvedCredentials.credentials.clientId
            : resolvedCredentials?.mode === 'inherit'
              ? null
              : existing.clientId,
        clientSecretPath:
          resolvedCredentials?.mode === 'custom'
            ? resolvedCredentials.credentials.clientSecret
              ? secretPath
              : null
            : resolvedCredentials?.mode === 'inherit'
              ? null
              : existing.clientSecretPath,
        configuration,
        enabled: body.enabled ?? existing.enabled,
        updatedAt: new Date(),
      })
      .where(eq(oauthProviders.id, existing.id))
      .returning()
    if (
      existing.clientSecretPath &&
      resolvedCredentials &&
      (resolvedCredentials.mode === 'inherit' ||
        (resolvedCredentials.mode === 'custom' &&
          !resolvedCredentials.credentials.clientSecret))
    ) {
      await deleteVaultSecret(
        c.get('db'),
        existing.clientSecretPath,
        organization,
        true,
      )
    }
    const descriptor = (
      await listProviderDescriptors(
        c.get('db'),
        resolveBrokerConfig(c.env),
        providers,
        organization,
      )
    ).find(({ id }) => id === providerId)!
    await emitHookfishEvent(options.onEvent, {
      type: 'provider.updated',
      occurredAt: new Date(),
      organization,
      provider: providerId,
    })
    return c.json({ provider: serializeProvider(descriptor, record) }, 200)
  })

  const deleteApi = patchApi.openapi(deleteRoute, async (c) => {
    assertRootAccess(c.get('accessGrant'))
    const providerId = normalizeProviderId(c.req.valid('param').provider_id)
    const { organization } = c.get('databaseContext')
    const existing = await findDynamicProvider(
      c.get('db'),
      providerId,
      organization,
    )
    if (!existing) {
      return c.json({ id: providerId, deleted: false }, 200)
    }
    const tenantFilter = organization
      ? or(
          eq(oauthConnections.organization, organization),
          and(
            isNull(oauthConnections.organization),
            or(
              eq(oauthConnections.connectionId, organization),
              sql<boolean>`starts_with(${oauthConnections.connectionId}, ${`${organization}/`})`,
            ),
          ),
        )
      : isNull(oauthConnections.organization)
    const connection = await c
      .get('db')
      .select({ id: oauthConnections.id })
      .from(oauthConnections)
      .where(and(eq(oauthConnections.provider, providerId), tenantFilter))
      .limit(1)
    if (connection.length > 0) {
      throw new BrokerError(
        409,
        'provider_in_use',
        `Provider "${providerId}" cannot be deleted while OAuth connections reference it.`,
      )
    }
    const deleted = await c
      .get('db')
      .delete(oauthProviders)
      .where(eq(oauthProviders.id, existing.id))
      .returning()
    if (existing.clientSecretPath) {
      await deleteVaultSecret(
        c.get('db'),
        existing.clientSecretPath,
        organization,
        true,
      )
    }
    if (deleted.length > 0) {
      await emitHookfishEvent(options.onEvent, {
        type: 'provider.deleted',
        occurredAt: new Date(),
        organization,
        provider: providerId,
      })
    }
    return c.json({ id: providerId, deleted: deleted.length > 0 }, 200)
  })

  deleteApi.onError((error, c) => {
    if (isBrokerError(error)) {
      return c.json(
        { error: { code: error.code, message: error.message } },
        error.status,
      )
    }
    console.error('provider management error', error)
    return c.json(
      {
        error: { code: 'internal_error', message: 'Unexpected broker error.' },
      },
      500,
    )
  })
  return deleteApi
}
