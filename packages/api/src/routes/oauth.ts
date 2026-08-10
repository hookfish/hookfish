import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import type { ProviderRegistry } from '@hookfish/provider'
import type { DatabaseInput } from '../db/binding'
import { emitHookfishEvent, type HookfishEventHandler } from '../events'
import {
  assertConnectionAccess,
  assertConnectionPrefixAccess,
} from '../oauth/access-token'
import {
  completeAuthorization,
  deleteConnection,
  failAuthorization,
  findConnection,
  getAccessToken,
  getAuthorizationState,
  getConnection,
  listConnections,
  startAuthorization,
} from '../oauth/broker'
import {
  type BrokerConfig,
  resolveRedirectUri,
  validateReturnTo,
} from '../oauth/config'
import { BrokerError, isBrokerError } from '../oauth/errors'
import { listProviderDescriptors } from '../oauth/dynamic-provider'
import {
  type BrokerContext,
  requireApiKey,
  withDatabase,
} from '../oauth/middleware'
import { ORGANIZATION_PATTERN } from '../oauth/organization'
import { organizationFromAuthorizationState } from '../oauth/state'

/**
 * References the `brokerApiKey` scheme registered in `src/index.ts`. Attaching
 * it is what puts the **Authorize** button in Swagger UI and makes its
 * generated curl include the bearer header. The callback route omits it.
 */
const brokerAuth = [{ brokerApiKey: [] }]

/** Example connection id shown in OpenAPI / Swagger. */
const EXAMPLE_CONNECTION_ID = 'swift-orchid-4821'
const MAX_ORGANIZATION_CONNECTION_PATH_LENGTH = 512

type OAuthRouteOptions = {
  returnTo?: string
  trustedOrigins?: readonly string[]
  organizationRouting?: boolean
  onEvent?: HookfishEventHandler
  routeMode: 'global' | 'organization'
}

function requestOrganization(
  request: { param(name: string): string | undefined },
  options: OAuthRouteOptions,
): string | undefined {
  if (options.routeMode === 'global') {
    if (options.organizationRouting) {
      throw new BrokerError(
        404,
        'organization_required',
        'Use an organization-prefixed OAuth route.',
      )
    }
    return undefined
  }

  if (!options.organizationRouting) {
    throw new BrokerError(
      404,
      'organization_routing_disabled',
      'Organization-prefixed OAuth routes are disabled.',
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

function assertOrganizationConnection(
  organization: string | undefined,
  connectionId: string,
): void {
  if (!organization) return

  assertCanonicalOrganizationPath(connectionId)

  if (
    connectionId === organization ||
    connectionId.startsWith(`${organization}/`)
  ) {
    return
  }

  throw new BrokerError(
    403,
    'organization_mismatch',
    `Connection "${connectionId}" is outside organization "${organization}".`,
  )
}

/**
 * Organization connection ids are URL-shaped namespaces. Keep their string
 * representation canonical so no later URL, proxy, or UI decoding step can
 * reinterpret a value as a different organization path.
 */
function assertCanonicalOrganizationPath(connectionPath: string): void {
  const segments = connectionPath.split('/')
  const structurallyInvalid =
    connectionPath.length === 0 ||
    connectionPath.length > MAX_ORGANIZATION_CONNECTION_PATH_LENGTH ||
    connectionPath !== connectionPath.normalize('NFC') ||
    connectionPath.includes('\\') ||
    hasUnsafePathCharacters(connectionPath) ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === '.' ||
        segment === '..' ||
        decodesToPathStructure(segment),
    )

  if (structurallyInvalid) {
    throw new BrokerError(
      400,
      'invalid_connection_path',
      'Organization connection paths must be canonical slash-delimited identifiers without empty, dot, encoded structural, control, or backslash segments.',
    )
  }
}

function decodesToPathStructure(segment: string): boolean {
  let decoded: string
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    // A literal percent sign is safe when the value is subsequently encoded as
    // a URL component. Only successfully decoded structural values are
    // ambiguous.
    return false
  }

  if (decoded === segment) return false

  return (
    decoded === '.' ||
    decoded === '..' ||
    decoded.includes('/') ||
    decoded.includes('\\') ||
    hasUnsafePathCharacters(decoded)
  )
}

function hasUnsafePathCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint === undefined) continue

    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x200e ||
      codePoint === 0x200f ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    ) {
      return true
    }
  }

  return false
}

function redirectWithResult(
  returnTo: string,
  result:
    | { status: 'connected'; provider: string; connectionId: string }
    | { status: 'error'; provider: string; error: string },
): string {
  const destination = new URL(returnTo)
  destination.searchParams.set('hookfish_status', result.status)
  destination.searchParams.set('provider', result.provider)
  if (result.status === 'connected') {
    destination.searchParams.set('connected', result.provider)
    destination.searchParams.set('connection_id', result.connectionId)
  } else {
    destination.searchParams.set('error', result.error)
  }
  return destination.toString()
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}

function developmentCompletionPage(
  provider: string,
  connectionId: string,
): string {
  const safeProvider = escapeHtml(provider)
  const safeConnectionId = escapeHtml(connectionId)

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Connection complete · Hookfish</title>
    <style>
      :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #0b1020; color: #eef2ff; }
      main { width: min(36rem, calc(100% - 3rem)); padding: 2.5rem; border: 1px solid #293451; border-radius: 1rem; background: #11182b; box-shadow: 0 1.5rem 4rem #0006; }
      .eyebrow { margin: 0 0 .75rem; color: #93c5fd; font-size: .75rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
      h1 { margin: 0; font-size: clamp(2rem, 8vw, 3rem); letter-spacing: -.04em; }
      p { color: #cbd5e1; line-height: 1.65; }
      .success { color: #86efac; font-weight: 700; }
      .notice { margin-top: 1.75rem; padding: 1rem 1.125rem; border: 1px solid #334155; border-radius: .75rem; background: #0b1222; }
      code { color: #bfdbfe; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">Hookfish development mode</p>
      <h1>Connection complete</h1>
      <p class="success">${safeProvider} connected successfully.</p>
      <p>Connection ID: <code>${safeConnectionId}</code></p>
      <div class="notice">
        <p>This is Hookfish's default development completion page.</p>
        <p>Before deploying, override it in <code>hookfish.config.ts</code> by setting <code>returnTo</code> to your application's integration page.</p>
      </div>
    </main>
  </body>
</html>`
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const errorSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: 'not_connected' }),
      message: z.string(),
    }),
  })
  .openapi('BrokerError')

function errorResponse(description: string) {
  return {
    description,
    content: { 'application/json': { schema: errorSchema } },
  }
}

const commonErrors = {
  400: errorResponse('Invalid request'),
  401: errorResponse(
    'Missing or invalid broker credential, or the connection needs reauthorizing',
  ),
  403: errorResponse('The broker access token does not cover this connection'),
  404: errorResponse('Unknown provider or no connection for this id'),
  409: errorResponse('Connection id is already linked to another provider'),
  500: errorResponse('Broker is misconfigured'),
  502: errorResponse('The provider rejected the token request'),
}

const providerParamSchema = z.object({
  provider: z
    .string()
    .openapi({ param: { name: 'provider', in: 'path' }, example: 'notion' }),
})

const connectionIdParamSchema = z.object({
  connection_id: z
    .string()
    .min(1)
    .openapi({
      param: { name: 'connection_id', in: 'path' },
      example: EXAMPLE_CONNECTION_ID,
    }),
})

const connectionSchema = z
  .object({
    connection_id: z.string().openapi({ example: EXAMPLE_CONNECTION_ID }),
    provider: z.string().openapi({ example: 'notion' }),
    scopes: z.array(z.string()),
    expires_at: z.string().nullable(),
    external_account_id: z.string().nullable(),
    external_account_label: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('OAuthConnection')

/** Never serialises the encrypted token columns. */
function serializeConnection(
  connection: Awaited<ReturnType<typeof listConnections>>[number],
) {
  return {
    connection_id: connection.connectionId,
    provider: connection.provider,
    scopes: connection.scopes,
    expires_at: connection.expiresAt?.toISOString() ?? null,
    external_account_id: connection.externalAccountId,
    external_account_label: connection.externalAccountLabel,
    metadata: connection.metadata,
    created_at: connection.createdAt.toISOString(),
    updated_at: connection.updatedAt.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const listProvidersRoute = createRoute({
  method: 'get',
  path: '/providers',
  summary: 'List known providers and whether credentials are configured',
  description:
    "Each `callback_url` is the exact string this deployment will send as `redirect_uri`. Paste it into the provider's developer console verbatim -- providers match it byte for byte.",
  security: brokerAuth,
  responses: {
    200: {
      description: 'Provider registry',
      content: {
        'application/json': {
          schema: z.object({
            providers: z.array(
              z.object({
                id: z.string(),
                label: z.string(),
                configured: z.boolean(),
                callback_url: z.string(),
                scopes: z.array(z.string()),
                available_scopes: z.array(z.string()),
                supports_refresh: z.boolean(),
                supports_revocation: z.boolean(),
                uses_pkce: z.boolean(),
              }),
            ),
          }),
        },
      },
    },
    ...commonErrors,
  },
})

const authorizeRoute = createRoute({
  method: 'post',
  path: '/{provider}/authorize',
  summary: 'Create a consent URL for a connection',
  description:
    'Returns the provider consent URL. Redirect the user there; the broker handles the callback and stores the tokens. Omit `connection_id` to have the broker mint one (`word-word-number`), optionally below `connection_id_prefix`. Each connection id is one provider link.',
  security: brokerAuth,
  request: {
    params: providerParamSchema,
    body: {
      content: {
        'application/json': {
          schema: z.object({
            connection_id: z.string().min(1).optional().openapi({
              description:
                'Opaque id for this provider link. Omit to auto-generate as `word-word-number` (e.g. `swift-orchid-4821`). Re-pass the same id to reconnect the same link; a different provider on an existing id returns 409.',
              example: EXAMPLE_CONNECTION_ID,
            }),
            connection_id_prefix: z.string().min(1).optional().openapi({
              description:
                'Slash-delimited path below which the broker should mint an id. Use this only when connection_id is omitted.',
              example: 'team/payments',
            }),
            scopes: z.array(z.string()).optional().openapi({
              description:
                'Scopes requested for this flow. Leave empty to use the provider defaults -- Swagger otherwise prefills a literal ["string"], which would be sent to the provider verbatim.',
              default: [],
              example: [],
            }),
            return_to: z.url().optional().openapi({
              description:
                'Absolute post-callback destination. Its origin must appear in Hookfish trustedOrigins.',
              example: 'https://app.example.com/settings/integrations',
            }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Consent URL created',
      content: {
        'application/json': {
          schema: z.object({
            connection_id: z.string(),
            authorize_url: z.string(),
            expires_at: z.string(),
          }),
        },
      },
    },
    ...commonErrors,
  },
})

const callbackRoute = createRoute({
  method: 'get',
  path: '/{provider}/callback',
  summary: 'OAuth redirect target (called by the provider, not by your code)',
  description:
    "Register this URL in the provider's developer console, one per provider. Call `GET /providers` for the exact strings this deployment uses -- they depend on the branch and on how the API is reached, so they are not hard-coded here. Authenticated by the single-use `state` parameter rather than the broker API key.",
  request: {
    params: providerParamSchema,
    query: z.object({
      code: z.string().optional(),
      state: z.string().optional(),
      error: z.string().optional(),
      error_description: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Connection stored; default development page displayed',
      content: {
        'text/html': { schema: z.string() },
      },
    },
    302: { description: 'Redirected to the configured `returnTo` URL' },
    ...commonErrors,
  },
})

const listConnectionsRoute = createRoute({
  method: 'get',
  path: '/connections',
  summary: 'List connections',
  description:
    'Returns every stored connection. Pass `provider`, `connection_id_prefix`, or both to filter. Connection id prefixes respect `/` segment boundaries: `team/apple` matches itself and `team/apple/...`, but not `team/apples`.',
  security: brokerAuth,
  request: {
    query: z.object({
      provider: z
        .string()
        .min(1)
        .optional()
        .openapi({
          param: { name: 'provider', in: 'query' },
          example: 'notion',
        }),
      connection_id_prefix: z
        .string()
        .min(1)
        .optional()
        .openapi({
          param: { name: 'connection_id_prefix', in: 'query' },
          example: 'team/',
        }),
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

const getConnectionRoute = createRoute({
  method: 'get',
  path: '/connections/{connection_id}',
  summary: 'Get a connection by id',
  security: brokerAuth,
  request: { params: connectionIdParamSchema },
  responses: {
    200: {
      description: 'Connection',
      content: {
        'application/json': {
          schema: z.object({ connection: connectionSchema }),
        },
      },
    },
    ...commonErrors,
  },
})

const tokenRoute = createRoute({
  method: 'get',
  path: '/tokens/{connection_id}',
  summary: 'Get a currently-valid access token, refreshing if needed',
  security: brokerAuth,
  request: { params: connectionIdParamSchema },
  responses: {
    200: {
      description: 'A token that is valid right now',
      content: {
        'application/json': {
          schema: z.object({
            connection_id: z.string(),
            provider: z.string(),
            access_token: z.string(),
            token_type: z.string(),
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

const disconnectRoute = createRoute({
  method: 'delete',
  path: '/connections/{connection_id}',
  summary: 'Revoke and forget a stored connection',
  description:
    'Revokes upstream credentials when the provider implements revocation, then deletes the encrypted local record. If upstream revocation fails, the record is retained so the operation can be retried. Providers without revocation support are deleted locally.',
  security: brokerAuth,
  request: { params: connectionIdParamSchema },
  responses: {
    200: {
      description: 'Deletion result',
      content: {
        'application/json': {
          schema: z.object({
            deleted: z.boolean(),
            revocation: z.enum(['revoked', 'unsupported', 'not_found']),
          }),
        },
      },
    },
    ...commonErrors,
  },
})

// OpenAPI path parameters only match one path segment, while connection ids
// are deliberately allowed to contain `/`. Keep the conventional OpenAPI
// paths above for documentation, and use Hono's regex parameter syntax at
// runtime so the parameter consumes the complete remainder of the path.
const getConnectionRuntimeRoute = createRoute({
  ...getConnectionRoute,
  path: '/connections/:connection_id{.+}',
  hide: true,
})

const tokenRuntimeRoute = createRoute({
  ...tokenRoute,
  path: '/tokens/:connection_id{.+}',
  hide: true,
})

const disconnectRuntimeRoute = createRoute({
  ...disconnectRoute,
  path: '/connections/:connection_id{.+}',
  hide: true,
})

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export function createOAuthRoutes<Bindings extends object>(
  providers: ProviderRegistry,
  resolveConfig: () => BrokerConfig,
  database: DatabaseInput<Bindings>,
  options: OAuthRouteOptions,
) {
  const oauthRoutes = new OpenAPIHono<BrokerContext<Bindings>>()
  const authenticate = requireApiKey<Bindings>(resolveConfig)
  const connectManagementDatabase = withDatabase(database, (request) => ({
    organization: requestOrganization(request, options),
  }))
  const connectCallbackDatabase = withDatabase(database, async (request) => ({
    organization: await organizationFromAuthorizationState(
      resolveConfig(),
      request.query('state'),
    ),
  }))

  oauthRoutes.use('/providers', connectManagementDatabase, authenticate)
  oauthRoutes.use(
    '/:provider/authorize',
    connectManagementDatabase,
    authenticate,
  )
  oauthRoutes.use('/:provider/callback', connectCallbackDatabase)
  oauthRoutes.use('/connections', connectManagementDatabase, authenticate)
  oauthRoutes.use('/connections/*', connectManagementDatabase, authenticate)
  oauthRoutes.use('/tokens/*', connectManagementDatabase, authenticate)

  // The runtime variants are hidden because regex parameters are a Hono
  // extension, not valid OpenAPI path syntax.
  oauthRoutes.openAPIRegistry.registerPath(getConnectionRoute)
  oauthRoutes.openAPIRegistry.registerPath(tokenRoute)
  oauthRoutes.openAPIRegistry.registerPath(disconnectRoute)

  const providersApi = oauthRoutes.openapi(listProvidersRoute, async (c) => {
    const { organization } = c.get('databaseContext')
    if (organization) {
      assertConnectionPrefixAccess(c.get('accessGrant'), organization)
    }
    const config = resolveConfig()
    return c.json(
      {
        providers: (
          await listProviderDescriptors(
            c.get('db'),
            config,
            providers,
            organization,
          )
        ).map(({ id: slug, label, configured, provider }) => {
          return {
            id: slug,
            label,
            configured,
            // Derived from this request, so it stays correct across branches,
            // `pnpm dev` vs. `server dev`, and deployed environments.
            callback_url: resolveRedirectUri(config, c.req.url, slug),
            scopes: [...(provider?.defaultScopes ?? [])],
            available_scopes: [...(provider?.availableScopes ?? [])],
            supports_refresh: provider?.refreshToken !== undefined,
            supports_revocation: provider?.revokeToken !== undefined,
            uses_pkce: provider?.usesPkce ?? false,
          }
        }),
      },
      200,
    )
  })

  const authorizeApi = providersApi.openapi(authorizeRoute, async (c) => {
    const { provider } = c.req.valid('param')
    const body = c.req.valid('json')
    const config = resolveConfig()
    const { organization } = c.get('databaseContext')
    const connectionIdPrefix =
      body.connection_id_prefix ??
      (organization && !body.connection_id ? organization : undefined)

    if (body.connection_id) {
      assertOrganizationConnection(organization, body.connection_id)
    }
    if (connectionIdPrefix) {
      assertOrganizationConnection(organization, connectionIdPrefix)
    }

    if (body.connection_id) {
      assertConnectionAccess(c.get('accessGrant'), body.connection_id)
    } else if (connectionIdPrefix) {
      assertConnectionPrefixAccess(c.get('accessGrant'), connectionIdPrefix)
    } else if (!c.get('accessGrant').scopes.includes('**')) {
      throw new BrokerError(
        400,
        'connection_id_required',
        'A scoped broker access token must provide a connection_id or connection_id_prefix within its scope.',
      )
    }

    const result = await startAuthorization(
      c.get('db'),
      config,
      {
        connectionId: body.connection_id,
        connectionIdPrefix,
        provider,
        organization,
        redirectUri: resolveRedirectUri(config, c.req.url, provider),
        returnTo: validateReturnTo(
          body.return_to,
          options.trustedOrigins ?? [],
        ),
        scopes: body.scopes,
      },
      providers,
    )

    await emitHookfishEvent(options.onEvent, {
      type: 'authorization.started',
      occurredAt: new Date(),
      organization,
      provider,
      connectionId: result.connectionId,
    })

    return c.json(
      {
        connection_id: result.connectionId,
        authorize_url: result.authorizeUrl,
        expires_at: result.expiresAt.toISOString(),
      },
      200,
    )
  })

  const callbackApi = authorizeApi.openapi(callbackRoute, async (c) => {
    if (options.routeMode === 'organization') {
      throw new BrokerError(
        404,
        'global_callback_required',
        'OAuth providers must use the global callback URL.',
      )
    }
    const { provider } = c.req.valid('param')
    const query = c.req.valid('query')

    if (query.error) {
      if (!query.state) {
        return c.json(
          {
            error: {
              code: 'invalid_callback',
              message: 'The callback is missing the `state` parameter.',
            },
          },
          400,
        )
      }

      const requestedMessage =
        query.error_description ??
        `${provider} denied the authorization request.`
      const failed = await failAuthorization(c.get('db'), {
        provider,
        state: query.state,
        errorCode: query.error,
        errorMessage: requestedMessage,
      })
      const errorCode = failed.state.errorCode ?? query.error
      const message = failed.state.errorMessage ?? requestedMessage
      await emitHookfishEvent(options.onEvent, {
        type: 'authorization.failed',
        occurredAt: new Date(),
        organization: failed.state.organization ?? undefined,
        provider,
        connectionId: failed.state.connectionId,
        errorCode,
        replayed: failed.replayed,
      })

      const returnTo = failed.state.returnTo ?? options.returnTo
      if (returnTo) {
        return c.redirect(
          redirectWithResult(returnTo, {
            status: 'error',
            provider,
            error: errorCode,
          }),
          302,
        )
      }

      return c.json({ error: { code: errorCode, message } }, 400)
    }

    if (!query.code || !query.state) {
      return c.json(
        {
          error: {
            code: 'invalid_callback',
            message: 'The callback is missing the `code` or `state` parameter.',
          },
        },
        400,
      )
    }

    const config = resolveConfig()
    let completed: Awaited<ReturnType<typeof completeAuthorization>>
    try {
      completed = await completeAuthorization(
        c.get('db'),
        config,
        { provider, code: query.code, state: query.state },
        providers,
      )
    } catch (error) {
      const authorization = await getAuthorizationState(
        c.get('db'),
        provider,
        query.state,
      )
      const errorCode = isBrokerError(error) ? error.code : 'internal_error'
      await emitHookfishEvent(options.onEvent, {
        type: 'authorization.failed',
        occurredAt: new Date(),
        organization: authorization?.organization ?? undefined,
        provider,
        connectionId: authorization?.connectionId,
        errorCode,
      })

      const returnTo = authorization?.returnTo ?? options.returnTo
      if (returnTo && authorization) {
        return c.redirect(
          redirectWithResult(returnTo, {
            status: 'error',
            provider,
            error: errorCode,
          }),
          302,
        )
      }
      throw error
    }

    await emitHookfishEvent(options.onEvent, {
      type: 'authorization.connected',
      occurredAt: new Date(),
      organization: completed.state.organization ?? undefined,
      provider,
      connectionId: completed.connection.connectionId,
      replayed: completed.replayed,
    })

    const returnTo = completed.state.returnTo ?? options.returnTo
    if (returnTo) {
      return c.redirect(
        redirectWithResult(returnTo, {
          status: 'connected',
          provider,
          connectionId: completed.connection.connectionId,
        }),
        302,
      )
    }

    c.header('Cache-Control', 'no-store')
    c.header(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    )
    c.header('Referrer-Policy', 'no-referrer')
    c.header('X-Content-Type-Options', 'nosniff')
    return c.html(
      developmentCompletionPage(provider, completed.connection.connectionId),
      200,
    )
  })

  const listApi = callbackApi.openapi(listConnectionsRoute, async (c) => {
    const { provider, connection_id_prefix: requestedPrefix } =
      c.req.valid('query')
    const { organization } = c.get('databaseContext')
    if (organization) {
      assertConnectionPrefixAccess(c.get('accessGrant'), organization)
    }
    if (requestedPrefix) {
      assertOrganizationConnection(organization, requestedPrefix)
    }
    const connectionIdPrefix = requestedPrefix ?? organization
    const grant = c.get('accessGrant')
    const connections = await listConnections(c.get('db'), {
      provider,
      connectionIdPrefix,
      connectionScopes: grant.scopes,
      organization,
    })

    return c.json({ connections: connections.map(serializeConnection) }, 200)
  })

  const connectionApi = listApi.openapi(
    getConnectionRuntimeRoute,
    async (c) => {
      const { connection_id: connectionId } = c.req.valid('param')
      const { organization } = c.get('databaseContext')
      assertOrganizationConnection(organization, connectionId)
      assertConnectionAccess(c.get('accessGrant'), connectionId)
      const connection = await getConnection(
        c.get('db'),
        connectionId,
        organization,
      )

      return c.json({ connection: serializeConnection(connection) }, 200)
    },
  )

  const tokenApi = connectionApi.openapi(tokenRuntimeRoute, async (c) => {
    const { connection_id: connectionId } = c.req.valid('param')
    const { organization } = c.get('databaseContext')
    assertOrganizationConnection(organization, connectionId)
    assertConnectionAccess(c.get('accessGrant'), connectionId)
    const config = resolveConfig()
    const token = await getAccessToken(
      c.get('db'),
      config,
      connectionId,
      providers,
      organization,
    )

    await emitHookfishEvent(options.onEvent, {
      type: 'connection.token_retrieved',
      occurredAt: new Date(),
      organization,
      provider: token.provider,
      connectionId,
      refreshed: token.refreshed,
    })

    c.header('Cache-Control', 'no-store')
    c.header('Pragma', 'no-cache')

    return c.json(
      {
        connection_id: token.connectionId,
        provider: token.provider,
        access_token: token.accessToken,
        token_type: token.tokenType,
        scopes: token.scopes,
        expires_at: token.expiresAt?.toISOString() ?? null,
        refreshed: token.refreshed,
      },
      200,
    )
  })

  const routes = tokenApi.openapi(disconnectRuntimeRoute, async (c) => {
    const { connection_id: connectionId } = c.req.valid('param')
    const { organization } = c.get('databaseContext')
    assertOrganizationConnection(organization, connectionId)
    assertConnectionAccess(c.get('accessGrant'), connectionId)
    const config = resolveConfig()
    const connection = await findConnection(
      c.get('db'),
      connectionId,
      organization,
    )
    const result = await deleteConnection(
      c.get('db'),
      config,
      connectionId,
      providers,
      organization,
    )

    if (result.deleted && connection) {
      await emitHookfishEvent(options.onEvent, {
        type: 'connection.disconnected',
        occurredAt: new Date(),
        organization,
        provider: connection.provider,
        connectionId,
      })
    }

    return c.json(result, 200)
  })

  routes.onError((error, c) => {
    if (isBrokerError(error)) {
      return c.json(
        { error: { code: error.code, message: error.message } },
        error.status,
      )
    }

    console.error('oauth broker error', error)

    return c.json(
      {
        error: { code: 'internal_error', message: 'Unexpected broker error.' },
      },
      500,
    )
  })

  return routes
}
