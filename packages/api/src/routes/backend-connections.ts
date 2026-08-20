import { OpenAPIHono } from '@hono/zod-openapi'
import type {
  HookfishBackend,
  HookfishBackendConnection,
  HookfishBackendConnectionInput,
  HookfishBackendContext,
} from '../backend.js'
import {
  type AccessGrant,
  assertConnectionAccess,
  authenticateApplicationAccessToken,
  scopesAllowResource,
} from '../oauth/access-token.js'
import {
  requireBrokerApiKey,
  resolveBrokerConfig,
  validateReturnTo,
} from '../oauth/config.js'
import { safeEqual } from '../oauth/crypto.js'
import { BrokerError, isBrokerError } from '../oauth/errors.js'
import {
  normalizeProviderId,
  parseConnectionPath,
} from '../oauth/resource-path.js'
import { managedBackendConnectionOpenAPIRoutes } from './connections.js'

type BackendRouteOptions<Bindings extends object> = {
  trustedOrigins?: readonly string[]
  rootApiKey?: string | ((bindings: Bindings | undefined) => string)
}

type ManagedBrokerContext<Bindings extends object> = {
  Bindings: Bindings
  Variables: { accessGrant: AccessGrant }
}

function dateString(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  return value instanceof Date ? value.toISOString() : value
}

function serializeConnection(connection: HookfishBackendConnection) {
  const now = new Date().toISOString()
  return {
    path: connection.path,
    namespace: connection.namespace,
    provider_id: connection.providerId,
    configuration: connection.configuration ?? {},
    scopes: connection.scopes ?? [],
    expires_at: dateString(connection.expiresAt),
    external_account_id: connection.externalAccountId ?? null,
    external_account_label: connection.externalAccountLabel ?? null,
    metadata: connection.metadata ?? {},
    created_at: dateString(connection.createdAt) ?? now,
    updated_at: dateString(connection.updatedAt) ?? now,
  }
}

function rootApiKey<Bindings extends object>(
  options: BackendRouteOptions<Bindings>,
  bindings: Bindings,
): string {
  return typeof options.rootApiKey === 'function'
    ? options.rootApiKey(bindings)
    : (options.rootApiKey ?? requireBrokerApiKey(resolveBrokerConfig(bindings)))
}

async function authenticate<Bindings extends object>(
  request: Request,
  bindings: Bindings,
  options: BackendRouteOptions<Bindings>,
): Promise<AccessGrant> {
  const header = request.headers.get('Authorization') ?? ''
  const presented = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!presented) {
    throw new BrokerError(
      401,
      'unauthorized',
      'Missing Authorization header. Send: Authorization: Bearer <token>',
    )
  }
  const expected = rootApiKey(options, bindings)
  return safeEqual(presented, expected)
    ? { kind: 'root', scopes: ['**'] }
    : authenticateApplicationAccessToken(expected, presented)
}

function backendContext<Bindings extends object>(
  request: Request,
  bindings: Bindings,
  accessGrant: AccessGrant,
): HookfishBackendContext<Bindings> {
  return {
    request,
    bindings,
    accessGrant,
    principal:
      accessGrant.kind === 'scoped' ? accessGrant.application : undefined,
  }
}

function parseInput(
  path: string,
  body: Record<string, unknown> = {},
): HookfishBackendConnectionInput {
  const parsed = parseConnectionPath(path)
  const configuration = body.configuration
  const scopes = body.scopes
  const returnTo = body.return_to
  return {
    path: parsed.path,
    namespace: parsed.namespace,
    providerId: parsed.providerId,
    ...(isRecord(configuration) ? { configuration } : {}),
    ...(Array.isArray(scopes) &&
    scopes.every((scope) => typeof scope === 'string')
      ? { scopes }
      : {}),
    ...(typeof returnTo === 'string' ? { returnTo } : {}),
  }
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.body) return {}
  const body: unknown = await request.json().catch(() => ({}))
  return isRecord(body) ? body : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function authorizationRequired(
  path: string,
  result: {
    authorizeUrl: string
    expiresAt: Date | string
  },
): BrokerError {
  return new BrokerError(
    401,
    'authorization_required',
    `Connection "${path}" requires authorization.`,
    {
      authorize_url: result.authorizeUrl,
      expires_at: dateString(result.expiresAt),
    },
  )
}

/** Mount a managed, OAuth-only backend under the existing connection API. */
export function createBackendConnectionRoutes<Bindings extends object>(
  backend: HookfishBackend<Bindings>,
  options: BackendRouteOptions<Bindings> = {},
) {
  const routes = new OpenAPIHono<ManagedBrokerContext<Bindings>>()

  for (const route of managedBackendConnectionOpenAPIRoutes) {
    routes.openAPIRegistry.registerPath(route)
  }

  routes.use('*', async (c, next) => {
    c.set('accessGrant', await authenticate(c.req.raw, c.env, options))
    await next()
  })

  routes.get('/providers', async (c) => {
    const grant = c.get('accessGrant')
    const result = await backend.adapter.listProviders(
      backendContext(c.req.raw, c.env, grant),
      new URL(c.req.url).searchParams,
    )
    return c.json({
      providers: result.providers.map((provider) => ({
        id: normalizeProviderId(provider.id),
        label: provider.label,
        authentication: 'oauth' as const,
        input_schema: { fields: provider.inputSchema?.fields ?? [] },
      })),
    })
  })

  routes.post('/access/:connection_path{.+}', async (c) => {
    const input = parseInput(
      c.req.param('connection_path'),
      await jsonBody(c.req.raw),
    )
    input.returnTo = validateReturnTo(
      input.returnTo,
      options.trustedOrigins ?? [],
    )
    const grant = c.get('accessGrant')
    assertConnectionAccess(grant, input.path)
    const result = await backend.adapter.access(
      backendContext(c.req.raw, c.env, grant),
      input,
    )
    if (result.status === 'authorization_required') {
      throw authorizationRequired(input.path, result)
    }
    c.header('Cache-Control', 'no-store')
    c.header('Pragma', 'no-cache')
    return c.json({
      path: input.path,
      secret: result.secret,
      scopes: result.scopes ?? [],
      expires_at: dateString(result.expiresAt),
      refreshed: result.refreshed ?? false,
    })
  })

  routes.post('/authorize/:connection_path{.+}', async (c) => {
    const input = parseInput(
      c.req.param('connection_path'),
      await jsonBody(c.req.raw),
    )
    input.returnTo = validateReturnTo(
      input.returnTo,
      options.trustedOrigins ?? [],
    )
    const grant = c.get('accessGrant')
    assertConnectionAccess(grant, input.path)
    const result = await backend.adapter.authorize(
      backendContext(c.req.raw, c.env, grant),
      input,
    )
    throw authorizationRequired(input.path, result)
  })

  routes.put('/secret/:connection_path{.+}', () => {
    throw new BrokerError(
      409,
      'static_secrets_unsupported',
      'Managed OAuth backends do not store caller-supplied static secrets.',
    )
  })

  routes.get('/', async (c) => {
    const grant = c.get('accessGrant')
    const query = new URL(c.req.url).searchParams
    const connections = await backend.adapter.listConnections(
      backendContext(c.req.raw, c.env, grant),
      {
        namespace: query.get('namespace') ?? undefined,
        providerId: query.get('provider_id')
          ? normalizeProviderId(query.get('provider_id')!)
          : undefined,
      },
    )
    return c.json({
      connections: connections
        .filter((connection) =>
          scopesAllowResource(grant.scopes, connection.path),
        )
        .map(serializeConnection),
    })
  })

  routes.get('/entry/:connection_path{.+}', async (c) => {
    const input = parseInput(c.req.param('connection_path'))
    const grant = c.get('accessGrant')
    assertConnectionAccess(grant, input.path)
    const connection = await backend.adapter.getConnection(
      backendContext(c.req.raw, c.env, grant),
      input,
    )
    if (!connection) {
      throw new BrokerError(
        404,
        'connection_not_found',
        `Connection "${input.path}" was not found.`,
      )
    }
    return c.json({ connection: serializeConnection(connection) })
  })

  routes.delete('/entry/:connection_path{.+}', async (c) => {
    const input = parseInput(c.req.param('connection_path'))
    const grant = c.get('accessGrant')
    assertConnectionAccess(grant, input.path)
    const result = await backend.adapter.disconnect(
      backendContext(c.req.raw, c.env, grant),
      input,
    )
    return c.json({
      deleted: result.deleted,
      revocation: result.revocation ?? 'unsupported',
    })
  })

  routes.onError((error, c) => {
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
        error: { code: 'internal_error', message: 'Unexpected backend error.' },
      },
      500,
    )
  })

  return routes
}
