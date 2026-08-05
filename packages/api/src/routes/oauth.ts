import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import type { ProviderRegistry } from '@hookfish/provider'
import type { DatabaseInput } from '../db/binding'
import type { OAuthConnection } from '../db/schema'
import {
  completeAuthorization,
  deleteConnection,
  getAccessToken,
  getConnection,
  listConnections,
  startAuthorization,
} from '../oauth/broker'
import {
  assertConnectionAccess,
  assertConnectionPrefixAccess,
  scopesAllowConnection,
} from '../oauth/access-token'
import { resolveRedirectUri } from '../oauth/config'
import { BrokerError, isBrokerError } from '../oauth/errors'
import {
  type BrokerContext,
  requireApiKey,
  withDatabase,
} from '../oauth/middleware'

/**
 * References the `brokerApiKey` scheme registered in `src/index.ts`. Attaching
 * it is what puts the **Authorize** button in Swagger UI and makes its
 * generated curl include the bearer header. The callback route omits it.
 */
const brokerAuth = [{ brokerApiKey: [] }]

/** Example connection id shown in OpenAPI / Swagger. */
const EXAMPLE_CONNECTION_ID = 'swift-orchid-4821'

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
function serializeConnection(connection: OAuthConnection) {
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
                'Overrides the configured scopes for this flow. Leave empty to use the provider defaults from <PROVIDER>_SCOPES or the registry -- Swagger otherwise prefills a literal ["string"], which would be sent to the provider verbatim.',
              default: [],
              example: [],
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
            state: z.string(),
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
  database: DatabaseInput<Bindings>,
  returnTo?: string,
) {
  const oauthRoutes = new OpenAPIHono<BrokerContext<Bindings>>()
  const authenticate = requireApiKey<Bindings>()
  const connectDatabase = withDatabase(database)

  oauthRoutes.use('/providers', authenticate)
  oauthRoutes.use('/:provider/authorize', authenticate, connectDatabase)
  oauthRoutes.use('/:provider/callback', connectDatabase)
  oauthRoutes.use('/connections', authenticate, connectDatabase)
  oauthRoutes.use('/connections/*', authenticate, connectDatabase)
  oauthRoutes.use('/tokens/*', authenticate, connectDatabase)

  // The runtime variants are hidden because regex parameters are a Hono
  // extension, not valid OpenAPI path syntax.
  oauthRoutes.openAPIRegistry.registerPath(getConnectionRoute)
  oauthRoutes.openAPIRegistry.registerPath(tokenRoute)
  oauthRoutes.openAPIRegistry.registerPath(disconnectRoute)

  const providersApi = oauthRoutes.openapi(listProvidersRoute, (c) => {
    return c.json(
      {
        providers: providers.listProviders().map(([slug, provider]) => {
          return {
            id: slug,
            label: provider.label ?? slug,
            configured: providers.isProviderConfigured(slug),
            // Derived from this request, so it stays correct across branches,
            // `pnpm dev` vs. `server dev`, and deployed environments.
            callback_url: resolveRedirectUri(c.env, c.req.url, slug),
            scopes: [...(provider.defaultScopes ?? [])],
            available_scopes: [...(provider.availableScopes ?? [])],
            supports_refresh: provider.refreshToken !== undefined,
            supports_revocation: provider.revokeToken !== undefined,
            uses_pkce: provider.usesPkce ?? false,
          }
        }),
      },
      200,
    )
  })

  const authorizeApi = providersApi.openapi(authorizeRoute, async (c) => {
    const { provider } = c.req.valid('param')
    const body = c.req.valid('json')

    if (body.connection_id) {
      assertConnectionAccess(c.get('accessGrant'), body.connection_id)
    } else if (body.connection_id_prefix) {
      assertConnectionPrefixAccess(
        c.get('accessGrant'),
        body.connection_id_prefix,
      )
    } else if (!c.get('accessGrant').scopes.includes('**')) {
      throw new BrokerError(
        400,
        'connection_id_required',
        'A scoped broker access token must provide a connection_id within its scope.',
      )
    }

    const result = await startAuthorization(
      c.get('db'),
      c.env,
      {
        connectionId: body.connection_id,
        connectionIdPrefix: body.connection_id_prefix,
        provider,
        redirectUri: resolveRedirectUri(c.env, c.req.url, provider),
        scopes: body.scopes,
      },
      providers,
    )

    return c.json(
      {
        connection_id: result.connectionId,
        authorize_url: result.authorizeUrl,
        state: result.state,
        expires_at: result.expiresAt.toISOString(),
      },
      200,
    )
  })

  const callbackApi = authorizeApi.openapi(callbackRoute, async (c) => {
    const { provider } = c.req.valid('param')
    const query = c.req.valid('query')

    if (query.error) {
      return c.json(
        {
          error: {
            code: query.error,
            message:
              query.error_description ??
              `${provider} denied the authorization request.`,
          },
        },
        400,
      )
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

    const connection = await completeAuthorization(
      c.get('db'),
      c.env,
      { provider, code: query.code, state: query.state },
      providers,
    )

    if (returnTo) {
      const destination = new URL(returnTo)
      destination.searchParams.set('connected', provider)
      return c.redirect(destination.toString(), 302)
    }

    c.header('Cache-Control', 'no-store')
    c.header(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    )
    c.header('Referrer-Policy', 'no-referrer')
    c.header('X-Content-Type-Options', 'nosniff')
    return c.html(
      developmentCompletionPage(provider, connection.connectionId),
      200,
    )
  })

  const listApi = callbackApi.openapi(listConnectionsRoute, async (c) => {
    const { provider, connection_id_prefix: connectionIdPrefix } =
      c.req.valid('query')
    const grant = c.get('accessGrant')
    const connections = (
      await listConnections(c.get('db'), { provider, connectionIdPrefix })
    ).filter((connection) =>
      scopesAllowConnection(grant.scopes, connection.connectionId),
    )

    return c.json({ connections: connections.map(serializeConnection) }, 200)
  })

  const connectionApi = listApi.openapi(
    getConnectionRuntimeRoute,
    async (c) => {
      const { connection_id: connectionId } = c.req.valid('param')
      assertConnectionAccess(c.get('accessGrant'), connectionId)
      const connection = await getConnection(c.get('db'), connectionId)

      return c.json({ connection: serializeConnection(connection) }, 200)
    },
  )

  const tokenApi = connectionApi.openapi(tokenRuntimeRoute, async (c) => {
    const { connection_id: connectionId } = c.req.valid('param')
    assertConnectionAccess(c.get('accessGrant'), connectionId)
    const token = await getAccessToken(
      c.get('db'),
      c.env,
      connectionId,
      providers,
    )

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
    assertConnectionAccess(c.get('accessGrant'), connectionId)

    return c.json(
      await deleteConnection(c.get('db'), c.env, connectionId, providers),
      200,
    )
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
