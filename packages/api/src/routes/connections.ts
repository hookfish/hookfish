import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { isSecretProvider } from '@hookfish/provider'
import { stripAnyApplicationNamespace } from '../application-auth.js'
import type { DatabaseInput } from '../db/binding.js'
import { emitHookfishEvent, type HookfishEventHandler } from '../events.js'
import { assertConnectionAccess } from '../oauth/access-token.js'
import type { AccessGrant } from '../oauth/access-token.js'
import {
  accessConnection,
  authorizeConnection,
  completeAuthorization,
  disconnectConnection,
  failAuthorization,
  setConnectionSecret,
} from '../oauth/broker.js'
import {
  resolveBrokerConfig,
  resolveClientMetadataUri,
  resolveConnectionCallbackUri,
  validateReturnTo,
} from '../oauth/config.js'
import { BrokerError, isBrokerError } from '../oauth/errors.js'
import {
  type BrokerContext,
  requireApiKey,
  withDatabase,
} from '../oauth/middleware.js'
import {
  formatConnectionPath,
  MAX_RESOURCE_PATH_LENGTH,
  normalizeProviderId,
  parseConnectionPath,
} from '../oauth/resource-path.js'
import type { BoundProviderSource } from '../provider-source.js'

const brokerAuth = [{ brokerApiKey: [] }]

type ConnectionRouteOptions = {
  returnTo?: string
  trustedOrigins?: readonly string[]
  onEvent?: HookfishEventHandler
}

function applicationAudit(grant: AccessGrant): {
  subject?: string
  tenantId?: string
} {
  return grant.kind === 'scoped' && grant.application
    ? {
        subject: grant.application.subject,
        tenantId: grant.application.tenantId,
      }
    : {}
}

const errorSchema = z.object({
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      authorize_url: z.string().optional(),
      expires_at: z.string().optional(),
    })
    .catchall(z.unknown()),
})

const commonErrors = {
  400: {
    description: 'Invalid request',
    content: { 'application/json': { schema: errorSchema } },
  },
  401: {
    description: 'Authorization required or invalid broker credential',
    content: { 'application/json': { schema: errorSchema } },
  },
  403: {
    description: 'Insufficient resource scope',
    content: { 'application/json': { schema: errorSchema } },
  },
  404: {
    description: 'Connection, provider, or secret not found',
    content: { 'application/json': { schema: errorSchema } },
  },
  409: {
    description: 'Connection configuration conflict',
    content: { 'application/json': { schema: errorSchema } },
  },
  500: {
    description: 'Broker configuration error',
    content: { 'application/json': { schema: errorSchema } },
  },
  502: {
    description: 'Upstream provider error',
    content: { 'application/json': { schema: errorSchema } },
  },
  503: {
    description: 'Connection refresh is still in progress',
    content: { 'application/json': { schema: errorSchema } },
  },
}

const connectionPathParam = z.object({
  connection_path: z.string().min(1).max(MAX_RESOURCE_PATH_LENGTH),
})

const connectionAccessInput = z.object({
  configuration: z.record(z.string(), z.unknown()).optional(),
  scopes: z.array(z.string()).optional(),
  return_to: z.url().optional(),
})

const connectionSchema = z.object({
  path: z.string(),
  namespace: z.string(),
  provider_id: z.string(),
  configuration: z.record(z.string(), z.unknown()),
  scopes: z.array(z.string()),
  expires_at: z.string().nullable(),
  external_account_id: z.string().nullable(),
  external_account_label: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  created_at: z.string(),
  updated_at: z.string(),
})

function serializeConnection(
  connection: Awaited<
    ReturnType<BrokerContext['Variables']['db']['listConnections']>
  >[number],
) {
  return {
    path: formatConnectionPath(connection.namespace, connection.providerId),
    namespace: connection.namespace,
    provider_id: connection.providerId,
    configuration: connection.configuration,
    scopes: connection.scopes,
    expires_at: connection.expiresAt?.toISOString() ?? null,
    external_account_id: connection.externalAccountId,
    external_account_label: connection.externalAccountLabel,
    metadata: connection.metadata,
    created_at: connection.createdAt.toISOString(),
    updated_at: connection.updatedAt.toISOString(),
  }
}

const listProvidersRoute = createRoute({
  method: 'get',
  path: '/providers',
  operationId: 'connections.providers',
  summary: 'List trusted provider implementations',
  security: brokerAuth,
  responses: {
    200: {
      description: 'Provider implementations',
      content: {
        'application/json': {
          schema: z.object({
            providers: z.array(
              z.object({
                id: z.string(),
                label: z.string(),
                authentication: z.enum(['oauth', 'secret']),
                input_schema: z.object({
                  fields: z.array(
                    z.object({
                      name: z.string(),
                      label: z.string(),
                      type: z.enum(['text', 'url', 'string_list']),
                      target: z.enum(['identity', 'configuration', 'scopes']),
                      required: z.boolean(),
                      placeholder: z.string().optional(),
                      description: z.string().optional(),
                    }),
                  ),
                }),
              }),
            ),
          }),
        },
      },
    },
    ...commonErrors,
  },
})

const accessRoute = createRoute({
  method: 'post',
  path: '/access/{connection_path}',
  operationId: 'connections.access',
  summary: 'Get a usable secret or start authorization',
  description:
    'Returns the connection secret when ready. OAuth providers return `authorization_required` with a newly generated consent URL for scopes that have not been requested, or `scope_not_granted` when the provider declined a requested scope.',
  security: brokerAuth,
  request: {
    params: connectionPathParam,
    body: {
      required: false,
      content: {
        'application/json': {
          schema: connectionAccessInput,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Usable secret',
      content: {
        'application/json': {
          schema: z.object({
            path: z.string(),
            secret: z.string(),
            scopes: z.array(z.string()),
            expires_at: z.string().nullable(),
            refreshed: z.boolean(),
          }),
        },
      },
    },
    ...commonErrors,
  },
})

const authorizeRoute = createRoute({
  method: 'post',
  path: '/authorize/{connection_path}',
  operationId: 'connections.authorize',
  summary: 'Start fresh authorization for a connection',
  description:
    'Invalidates the current authorization attempt and returns `authorization_required` with a newly generated consent URL.',
  security: brokerAuth,
  request: {
    params: connectionPathParam,
    body: {
      required: false,
      content: {
        'application/json': {
          schema: connectionAccessInput,
        },
      },
    },
  },
  responses: commonErrors,
})

const setSecretRoute = createRoute({
  method: 'put',
  path: '/secret/{connection_path}',
  operationId: 'connections.setSecret',
  summary: 'Set or rotate a connection secret',
  security: brokerAuth,
  request: {
    params: connectionPathParam,
    body: {
      content: {
        'application/json': {
          schema: z.object({ secret: z.string().min(1).max(65_536) }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Secret stored',
      content: {
        'application/json': {
          schema: z.object({ path: z.string(), stored: z.literal(true) }),
        },
      },
    },
    ...commonErrors,
  },
})

const listRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'connections.list',
  summary: 'List connection metadata',
  security: brokerAuth,
  request: {
    query: z.object({
      namespace: z.string().optional(),
      provider_id: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Connections',
      content: {
        'application/json': {
          schema: z.object({ connections: z.array(connectionSchema) }),
        },
      },
    },
    ...commonErrors,
  },
})

const getRoute = createRoute({
  method: 'get',
  path: '/entry/{connection_path}',
  operationId: 'connections.get',
  summary: 'Get connection metadata',
  security: brokerAuth,
  request: { params: connectionPathParam },
  responses: {
    200: {
      description: 'Connection metadata',
      content: {
        'application/json': {
          schema: z.object({ connection: connectionSchema }),
        },
      },
    },
    ...commonErrors,
  },
})

const disconnectRoute = createRoute({
  method: 'delete',
  path: '/entry/{connection_path}',
  operationId: 'connections.disconnect',
  summary: 'Revoke and delete a connection',
  security: brokerAuth,
  request: { params: connectionPathParam },
  responses: {
    200: {
      description: 'Deletion result',
      content: {
        'application/json': {
          schema: z.object({
            deleted: z.boolean(),
            revocation: z.enum(['revoked', 'unsupported']),
          }),
        },
      },
    },
    ...commonErrors,
  },
})

const callbackRoute = createRoute({
  method: 'get',
  path: '/callback/{provider_id}',
  operationId: 'connections.callback',
  summary: 'OAuth callback',
  request: {
    params: z.object({ provider_id: z.string() }),
    query: z.object({
      code: z.string().optional(),
      state: z.string().optional(),
      error: z.string().optional(),
      error_description: z.string().optional(),
      iss: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Connection complete',
      content: { 'text/html': { schema: z.string() } },
    },
    302: { description: 'Redirect to application' },
    ...commonErrors,
  },
})

const clientMetadataRoute = createRoute({
  method: 'get',
  path: '/client-metadata.json',
  operationId: 'connections.clientMetadata',
  summary: 'Deployment-level OAuth client metadata document',
  responses: {
    200: {
      description: 'Client ID Metadata Document',
      content: {
        'application/json': {
          schema: z.object({
            client_id: z.url(),
            client_name: z.string(),
            redirect_uris: z.array(z.url()),
            grant_types: z.array(z.string()),
            response_types: z.array(z.string()),
            token_endpoint_auth_method: z.string(),
          }),
        },
      },
    },
  },
})

const accessRuntimeRoute = createRoute({
  ...accessRoute,
  path: '/access/:connection_path{.+}',
  hide: true,
})
const authorizeRuntimeRoute = createRoute({
  ...authorizeRoute,
  path: '/authorize/:connection_path{.+}',
  hide: true,
})
const secretRuntimeRoute = createRoute({
  ...setSecretRoute,
  path: '/secret/:connection_path{.+}',
  hide: true,
})
const getRuntimeRoute = createRoute({
  ...getRoute,
  path: '/entry/:connection_path{.+}',
  hide: true,
})
const disconnectRuntimeRoute = createRoute({
  ...disconnectRoute,
  path: '/entry/:connection_path{.+}',
  hide: true,
})

function completionPage(path: string): string {
  const safe = path.replace(
    /[&<>"']/g,
    (value) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        value
      ]!,
  )
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connection complete · Hookfish</title></head><body><main><h1>Connection complete</h1><p><code>${safe}</code> is ready.</p></main></body></html>`
}

export function createConnectionRoutes<Bindings extends object>(
  resolveProviders: (bindings: Bindings) => Promise<BoundProviderSource>,
  database: DatabaseInput<Bindings>,
  options: ConnectionRouteOptions,
) {
  const routes = new OpenAPIHono<BrokerContext<Bindings>>()
  const authenticate = requireApiKey<Bindings>()
  const connectDatabase = withDatabase(database)

  routes.use('/providers', connectDatabase, authenticate)
  routes.use('/access/*', connectDatabase, authenticate)
  routes.use('/authorize/*', connectDatabase, authenticate)
  routes.use('/secret/*', connectDatabase, authenticate)
  routes.use('/', connectDatabase, authenticate)
  routes.use('/entry/*', connectDatabase, authenticate)
  routes.use('/callback/*', connectDatabase)

  for (const route of [
    accessRoute,
    authorizeRoute,
    setSecretRoute,
    getRoute,
    disconnectRoute,
  ]) {
    routes.openAPIRegistry.registerPath(route)
  }

  const metadataApi = routes.openapi(clientMetadataRoute, (c) => {
    const clientId = resolveClientMetadataUri(
      resolveBrokerConfig(c.env),
      c.req.url,
    )
    return c.json(
      {
        client_id: clientId,
        client_name: 'Hookfish',
        redirect_uris: [
          resolveConnectionCallbackUri(
            resolveBrokerConfig(c.env),
            c.req.url,
            'mcp',
          ),
        ],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
      200,
    )
  })

  const providersApi = metadataApi.openapi(listProvidersRoute, async (c) => {
    const source = await resolveProviders(c.env)
    const result = await source.listProviders(new URL(c.req.url).searchParams)
    return c.json(
      {
        providers: result.providers.map(({ id, provider }) => ({
          id,
          label: provider.label ?? id,
          // Annotated so the literals survive inference in consumer builds,
          // where `c.json()` may widen them to `string`.
          authentication: isSecretProvider(provider)
            ? ('secret' as const)
            : ('oauth' as const),
          input_schema: {
            fields: [...(provider.inputSchema?.fields ?? [])],
          },
        })),
      },
      200,
    )
  })

  const accessApi = providersApi.openapi(accessRuntimeRoute, async (c) => {
    const parsed = parseConnectionPath(c.req.valid('param').connection_path)
    assertConnectionAccess(c.get('accessGrant'), parsed.path)
    const body = c.req.valid('json') ?? {}
    const config = resolveBrokerConfig(c.env)
    let result: Awaited<ReturnType<typeof accessConnection>>
    try {
      result = await accessConnection(
        c.get('db'),
        config,
        {
          namespace: parsed.namespace,
          providerId: parsed.providerId,
          configuration: body.configuration,
          scopes: body.scopes,
          returnTo: validateReturnTo(
            body.return_to,
            options.trustedOrigins ?? [],
          ),
          redirectUri: resolveConnectionCallbackUri(
            config,
            c.req.url,
            parsed.providerId,
          ),
          clientMetadataUrl: resolveClientMetadataUri(config, c.req.url),
        },
        await resolveProviders(c.env),
      )
    } catch (error) {
      if (isBrokerError(error) && error.code === 'authorization_required') {
        await emitHookfishEvent(options.onEvent, {
          type: 'authorization.started',
          occurredAt: new Date(),
          providerId: parsed.providerId,
          connectionPath: parsed.path,
          ...applicationAudit(c.get('accessGrant')),
        })
      }
      throw error
    }
    await emitHookfishEvent(options.onEvent, {
      type: 'connection.secret_accessed',
      occurredAt: new Date(),
      providerId: parsed.providerId,
      connectionPath: parsed.path,
      refreshed: result.refreshed,
      ...applicationAudit(c.get('accessGrant')),
    })
    c.header('Cache-Control', 'no-store')
    c.header('Pragma', 'no-cache')
    return c.json(
      {
        path: result.path,
        secret: result.secret,
        scopes: result.scopes,
        expires_at: result.expiresAt?.toISOString() ?? null,
        refreshed: result.refreshed,
      },
      200,
    )
  })

  const authorizeApi = accessApi.openapi(authorizeRuntimeRoute, async (c) => {
    const parsed = parseConnectionPath(c.req.valid('param').connection_path)
    assertConnectionAccess(c.get('accessGrant'), parsed.path)
    const body = c.req.valid('json') ?? {}
    const config = resolveBrokerConfig(c.env)
    try {
      return await authorizeConnection(
        c.get('db'),
        config,
        {
          namespace: parsed.namespace,
          providerId: parsed.providerId,
          configuration: body.configuration,
          scopes: body.scopes,
          returnTo: validateReturnTo(
            body.return_to,
            options.trustedOrigins ?? [],
          ),
          redirectUri: resolveConnectionCallbackUri(
            config,
            c.req.url,
            parsed.providerId,
          ),
          clientMetadataUrl: resolveClientMetadataUri(config, c.req.url),
        },
        await resolveProviders(c.env),
      )
    } catch (error) {
      if (isBrokerError(error) && error.code === 'authorization_required') {
        await emitHookfishEvent(options.onEvent, {
          type: 'authorization.started',
          occurredAt: new Date(),
          providerId: parsed.providerId,
          connectionPath: parsed.path,
          ...applicationAudit(c.get('accessGrant')),
        })
      }
      throw error
    }
  })

  const secretApi = authorizeApi.openapi(secretRuntimeRoute, async (c) => {
    const parsed = parseConnectionPath(c.req.valid('param').connection_path)
    assertConnectionAccess(c.get('accessGrant'), parsed.path)
    const body = c.req.valid('json')
    await setConnectionSecret(
      c.get('db'),
      resolveBrokerConfig(c.env),
      {
        namespace: parsed.namespace,
        providerId: parsed.providerId,
        value: body.secret,
      },
      await resolveProviders(c.env),
    )
    await emitHookfishEvent(options.onEvent, {
      type: 'connection.secret_stored',
      occurredAt: new Date(),
      providerId: parsed.providerId,
      connectionPath: parsed.path,
      ...applicationAudit(c.get('accessGrant')),
    })
    return c.json({ path: parsed.path, stored: true as const }, 200)
  })

  const listApi = secretApi.openapi(listRoute, async (c) => {
    const query = c.req.valid('query')
    const connections = await c.get('db').listConnections({
      namespace: query.namespace,
      providerId: query.provider_id
        ? normalizeProviderId(query.provider_id)
        : undefined,
      resourceScopes: c.get('accessGrant').scopes,
    })
    return c.json({ connections: connections.map(serializeConnection) }, 200)
  })

  const getApi = listApi.openapi(getRuntimeRoute, async (c) => {
    const parsed = parseConnectionPath(c.req.valid('param').connection_path)
    assertConnectionAccess(c.get('accessGrant'), parsed.path)
    const connection = await c
      .get('db')
      .getConnection(parsed.namespace, parsed.providerId)
    if (!connection)
      throw new BrokerError(
        404,
        'connection_not_found',
        `Connection "${parsed.path}" was not found.`,
      )
    return c.json({ connection: serializeConnection(connection) }, 200)
  })

  const disconnectApi = getApi.openapi(disconnectRuntimeRoute, async (c) => {
    const parsed = parseConnectionPath(c.req.valid('param').connection_path)
    assertConnectionAccess(c.get('accessGrant'), parsed.path)
    const connection = await c
      .get('db')
      .getConnection(parsed.namespace, parsed.providerId)
    if (!connection)
      return c.json({ deleted: false, revocation: 'unsupported' as const }, 200)
    const config = resolveBrokerConfig(c.env)
    const result = await disconnectConnection(
      c.get('db'),
      config,
      connection,
      await resolveProviders(c.env),
      resolveConnectionCallbackUri(config, c.req.url, parsed.providerId),
      resolveClientMetadataUri(config, c.req.url),
    )
    await emitHookfishEvent(options.onEvent, {
      type: 'connection.disconnected',
      occurredAt: new Date(),
      providerId: parsed.providerId,
      connectionPath: parsed.path,
      ...applicationAudit(c.get('accessGrant')),
    })
    return c.json(result, 200)
  })

  const callbackApi = disconnectApi.openapi(callbackRoute, async (c) => {
    const providerId = normalizeProviderId(c.req.valid('param').provider_id)
    const query = c.req.valid('query')
    if (!query.state)
      throw new BrokerError(
        400,
        'invalid_callback',
        'The callback is missing state.',
      )

    if (query.error) {
      const failed = await failAuthorization(c.get('db'), {
        providerId,
        state: query.state,
        errorCode: query.error,
        errorMessage:
          query.error_description ?? `${providerId} denied authorization.`,
      })
      await emitHookfishEvent(options.onEvent, {
        type: 'authorization.failed',
        occurredAt: new Date(),
        providerId,
        connectionPath: formatConnectionPath(
          failed.state.namespace,
          failed.state.providerId,
        ),
        errorCode: query.error,
        replayed: failed.replayed,
      })
      const returnTo = failed.state.returnTo ?? options.returnTo
      if (returnTo) {
        const destination = new URL(returnTo)
        destination.searchParams.set('hookfish_status', 'error')
        destination.searchParams.set('error', query.error)
        return c.redirect(destination.toString(), 302)
      }
      throw new BrokerError(
        400,
        query.error,
        failed.state.errorMessage ?? 'Authorization failed.',
      )
    }
    if (!query.code)
      throw new BrokerError(
        400,
        'invalid_callback',
        'The callback is missing code.',
      )
    const config = resolveBrokerConfig(c.env)
    const completed = await completeAuthorization(
      c.get('db'),
      config,
      {
        providerId,
        code: query.code,
        state: query.state,
        issuer: query.iss,
        clientMetadataUrl: resolveClientMetadataUri(config, c.req.url),
      },
      await resolveProviders(c.env),
    )
    const internalPath = formatConnectionPath(
      completed.connection.namespace,
      completed.connection.providerId,
    )
    const path = stripAnyApplicationNamespace(internalPath)
    await emitHookfishEvent(options.onEvent, {
      type: 'authorization.connected',
      occurredAt: new Date(),
      providerId,
      connectionPath: internalPath,
      replayed: completed.replayed,
    })
    const returnTo = completed.state.returnTo ?? options.returnTo
    if (returnTo) {
      const destination = new URL(returnTo)
      destination.searchParams.set('hookfish_status', 'connected')
      destination.searchParams.set('connection_path', path)
      return c.redirect(destination.toString(), 302)
    }
    c.header('Cache-Control', 'no-store')
    return c.html(completionPage(path), 200)
  })

  callbackApi.onError((error, c) => {
    if (isBrokerError(error)) {
      c.header('Cache-Control', 'no-store')
      return c.json(
        {
          error: { code: error.code, message: error.message, ...error.details },
        },
        error.status,
      )
    }
    console.error(error)
    return c.json(
      {
        error: { code: 'internal_error', message: 'Unexpected broker error.' },
      },
      500,
    )
  })

  return callbackApi
}
