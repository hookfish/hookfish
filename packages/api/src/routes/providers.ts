import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import {
  isOAuthProviderTemplate,
  type OAuthProviderTemplate,
  type ProviderConfiguration,
  ProviderConfigurationError,
  ProviderRequestError,
} from '@hookfish/provider'
import { createMiddleware } from 'hono/factory'
import type { DatabaseInput } from '../db/binding'
import { emitHookfishEvent, type HookfishEventHandler } from '../events'
import {
  assertProviderAccess,
  scopesAllowResource,
} from '../oauth/access-token'
import { resolveBrokerConfig, resolveRedirectUri } from '../oauth/config'
import {
  findDynamicProvider,
  listProviderDescriptorPage,
  listProviderDescriptors,
  normalizeProviderId,
  normalizeProviderLabel,
  normalizeProviderTemplateId,
  PROVIDER_ID_PATTERN,
} from '../oauth/dynamic-provider'
import { BrokerError, isBrokerError } from '../oauth/errors'
import {
  type BrokerContext,
  requireApiKey,
  withDatabase,
} from '../oauth/middleware'
import { ORGANIZATION_PATTERN } from '../oauth/organization'
import { assertOrganizationResourcePath } from '../oauth/resource-path'
import type { BoundProviderSource } from '../provider-source'
import {
  deleteVaultSecret,
  organizationKey,
  providerClientSecretPath,
  putVaultSecret,
} from '../vault'

const brokerAuth = [{ brokerApiKey: [] }]

const providerPathParam = z.object({
  provider_path: z.string().min(1).max(512),
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
const resolvedCredentialsSchema = z.discriminatedUnion('mode', [
  inheritedCredentials,
  z.object({
    mode: z.literal('custom'),
    credentials: z.object({
      clientId: z.string().trim().min(1).max(512),
      clientSecret: z.string().min(1).max(65_536).optional(),
    }),
  }),
])
const storedCredentialModeSchema = z
  .enum(['inherit', 'custom'])
  .catch('inherit')
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
  callback_url: z.string().url(),
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
    description: 'Credential cannot access this provider path',
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
  operationId: 'admin.providers.list',
  summary: 'List fixed and dynamic providers',
  security: brokerAuth,
  request: { query: z.object({}).catchall(z.coerce.string().optional()) },
  responses: {
    200: {
      description: 'Provider configurations',
      content: {
        'application/json': {
          schema: z
            .object({ providers: z.array(providerResponseSchema) })
            .catchall(z.unknown()),
        },
      },
    },
    ...errors,
  },
})

const getRoute = createRoute({
  method: 'get',
  path: '/providers/{provider_path}',
  operationId: 'admin.providers.get',
  summary: 'Get a provider configuration',
  security: brokerAuth,
  request: { params: providerPathParam },
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
  path: '/providers/{provider_path}',
  operationId: 'admin.providers.put',
  summary: 'Create or replace a dynamic provider',
  description:
    'Custom client secrets are encrypted and write-only. Inherited credentials use the complete credential pair from the fixed provider template.',
  security: brokerAuth,
  request: {
    params: providerPathParam,
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
  path: '/providers/{provider_path}',
  operationId: 'admin.providers.patch',
  summary: 'Update a dynamic provider',
  security: brokerAuth,
  request: {
    params: providerPathParam,
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
  path: '/providers/{provider_path}',
  operationId: 'admin.providers.delete',
  summary: 'Delete an unused dynamic provider',
  description:
    'Returns 409 while an OAuth connection references the provider. Disable it to block new authorizations while retaining refresh and revocation.',
  security: brokerAuth,
  request: { params: providerPathParam },
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

// Provider paths may contain `/`; OpenAPI documents the conventional path
// while Hono's runtime route consumes the complete remainder.
const getRuntimeRoute = createRoute({
  ...getRoute,
  path: '/providers/:provider_path{.+}',
  hide: true,
})
const putRuntimeRoute = createRoute({
  ...putRoute,
  path: '/providers/:provider_path{.+}',
  hide: true,
})
const patchRuntimeRoute = createRoute({
  ...patchRoute,
  path: '/providers/:provider_path{.+}',
  hide: true,
})
const deleteRuntimeRoute = createRoute({
  ...deleteRoute,
  path: '/providers/:provider_path{.+}',
  hide: true,
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

async function requireTemplate(
  providers: BoundProviderSource,
  templateId: string,
) {
  const template = await providers.getProvider(templateId)
  if (!template || !isOAuthProviderTemplate(template)) {
    throw new BrokerError(
      400,
      'invalid_provider_template',
      `Fixed provider "${templateId}" is not registered as a reusable provider template.`,
    )
  }
  return template
}

function assertOrganizationProvider(
  organization: string | undefined,
  providerId: string,
): void {
  assertOrganizationResourcePath(organization, providerId, 'provider')
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
): Promise<z.infer<typeof resolvedCredentialsSchema>> {
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

function providerCredentialFields(
  credentials: z.infer<typeof resolvedCredentialsSchema>,
  secretPath: string,
) {
  const resolved = resolvedCredentialsSchema.parse(credentials)
  if (resolved.mode === 'inherit') {
    return {
      credentialMode: 'inherit' as const,
      clientId: null,
      clientSecretPath: null,
    }
  }

  return {
    credentialMode: 'custom' as const,
    clientId: resolved.credentials.clientId,
    clientSecretPath: resolved.credentials.clientSecret ? secretPath : null,
  }
}

function serializeProvider(
  descriptor: Awaited<ReturnType<typeof listProviderDescriptors>>[number],
  callbackUrl: string,
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
    callback_url: callbackUrl,
    created_at: record?.createdAt.toISOString() ?? null,
    updated_at: record?.updatedAt.toISOString() ?? null,
  }
}

export function createProviderRoutes<Bindings extends object>(
  resolveProviders: (bindings: Bindings) => Promise<BoundProviderSource>,
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

  routes.openAPIRegistry.registerPath(getRoute)
  routes.openAPIRegistry.registerPath(putRoute)
  routes.openAPIRegistry.registerPath(patchRoute)
  routes.openAPIRegistry.registerPath(deleteRoute)

  const listApi = routes.openapi(listRoute, async (c) => {
    const { organization } = c.get('databaseContext')
    const providers = await resolveProviders(c.env)
    const grant = c.get('accessGrant')
    const page = await listProviderDescriptorPage(
      c.get('db'),
      resolveBrokerConfig(c.env),
      providers,
      organization,
      {},
      new URL(c.req.url).searchParams,
    )
    const { providers: listedProviders, ...listingMetadata } = page
    const descriptors = listedProviders.filter(
      ({ id, source }) =>
        source === 'fixed' || scopesAllowResource(grant.scopes, id),
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
        ...listingMetadata,
        providers: descriptors.map((descriptor, index) =>
          serializeProvider(
            descriptor,
            resolveRedirectUri(
              resolveBrokerConfig(c.env),
              c.req.url,
              descriptor.id,
            ),
            records[index],
          ),
        ),
      },
      200,
    )
  })

  const getApi = listApi.openapi(getRuntimeRoute, async (c) => {
    const providerId = normalizeProviderId(c.req.valid('param').provider_path)
    const { organization } = c.get('databaseContext')
    const providers = await resolveProviders(c.env)
    if (!(await providers.getProvider(providerId))) {
      assertOrganizationProvider(organization, providerId)
      assertProviderAccess(c.get('accessGrant'), providerId)
    }
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
    return c.json(
      {
        provider: serializeProvider(
          descriptor,
          resolveRedirectUri(resolveBrokerConfig(c.env), c.req.url, providerId),
          record,
        ),
      },
      200,
    )
  })

  const putApi = getApi.openapi(putRuntimeRoute, async (c) => {
    const providerId = normalizeProviderId(c.req.valid('param').provider_path)
    const providers = await resolveProviders(c.env)
    if (await providers.getProvider(providerId)) {
      throw new BrokerError(
        409,
        'fixed_provider_id',
        `Provider id "${providerId}" is reserved by a fixed provider.`,
      )
    }
    const { organization } = c.get('databaseContext')
    assertOrganizationProvider(organization, providerId)
    assertProviderAccess(c.get('accessGrant'), providerId)
    const body = c.req.valid('json')
    const templateId = normalizeProviderTemplateId(body.template)
    const template = await requireTemplate(providers, templateId)
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
    const existing = await findDynamicProvider(
      c.get('db'),
      providerId,
      organization,
    )
    const secretPath = providerClientSecretPath(providerId)
    const credentialFields = providerCredentialFields(
      resolvedCredentials,
      secretPath,
    )
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
    const record = await c.get('db').putOAuthProvider({
      organization: organizationKey(organization),
      providerId,
      templateId,
      label: normalizeProviderLabel(body.label) ?? null,
      ...credentialFields,
      configuration,
      enabled: body.enabled,
    })
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
    return c.json(
      {
        provider: serializeProvider(
          descriptor,
          resolveRedirectUri(resolveBrokerConfig(c.env), c.req.url, providerId),
          record,
        ),
      },
      200,
    )
  })

  const patchApi = putApi.openapi(patchRuntimeRoute, async (c) => {
    const providerId = normalizeProviderId(c.req.valid('param').provider_path)
    assertProviderAccess(c.get('accessGrant'), providerId)
    const { organization } = c.get('databaseContext')
    assertOrganizationProvider(organization, providerId)
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
      ? normalizeProviderTemplateId(body.template)
      : existing.templateId
    const template = await requireTemplate(providers, templateId)
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
    const secretPath = providerClientSecretPath(providerId)
    let credentialFields = {
      credentialMode: storedCredentialModeSchema.parse(existing.credentialMode),
      clientId: existing.clientId,
      clientSecretPath: existing.clientSecretPath,
    }
    if (resolvedCredentials) {
      credentialFields = providerCredentialFields(
        resolvedCredentials,
        secretPath,
      )
    }
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
    let label = existing.label
    if (body.label !== undefined) {
      label = normalizeProviderLabel(body.label ?? undefined) ?? null
    }
    const record = await c.get('db').updateOAuthProvider(existing.id, {
      templateId,
      label,
      ...credentialFields,
      configuration,
      enabled: body.enabled ?? existing.enabled,
    })
    if (!record) {
      throw new BrokerError(
        404,
        'unknown_provider',
        `Unknown dynamic provider "${providerId}".`,
      )
    }
    if (
      existing.clientSecretPath &&
      resolvedCredentials &&
      !credentialFields.clientSecretPath
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
    return c.json(
      {
        provider: serializeProvider(
          descriptor,
          resolveRedirectUri(resolveBrokerConfig(c.env), c.req.url, providerId),
          record,
        ),
      },
      200,
    )
  })

  const deleteApi = patchApi.openapi(deleteRuntimeRoute, async (c) => {
    const providerId = normalizeProviderId(c.req.valid('param').provider_path)
    assertProviderAccess(c.get('accessGrant'), providerId)
    const { organization } = c.get('databaseContext')
    assertOrganizationProvider(organization, providerId)
    const existing = await findDynamicProvider(
      c.get('db'),
      providerId,
      organization,
    )
    if (!existing) {
      return c.json({ id: providerId, deleted: false }, 200)
    }
    const deletion = await c
      .get('db')
      .deleteOAuthProviderIfUnused(existing.id, providerId, organization)
    if (deletion === 'in_use') {
      throw new BrokerError(
        409,
        'provider_in_use',
        `Provider "${providerId}" cannot be deleted while OAuth connections reference it.`,
      )
    }
    if (existing.clientSecretPath) {
      await deleteVaultSecret(
        c.get('db'),
        existing.clientSecretPath,
        organization,
        true,
      )
    }
    if (deletion === 'deleted') {
      await emitHookfishEvent(options.onEvent, {
        type: 'provider.deleted',
        occurredAt: new Date(),
        organization,
        provider: providerId,
      })
    }
    return c.json({ id: providerId, deleted: deletion === 'deleted' }, 200)
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
