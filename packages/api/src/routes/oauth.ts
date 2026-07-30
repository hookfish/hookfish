import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import type { OAuthConnection } from '../db/schema'
import {
  completeAuthorization,
  deleteConnection,
  getAccessToken,
  getConnection,
  listConnections,
  startAuthorization,
} from '../oauth/broker'
import { isProviderConfigured, resolveRedirectUri } from '../oauth/config'
import { isBrokerError } from '../oauth/errors'
import {
  type BrokerContext,
  requireApiKey,
  withDatabase,
} from '../oauth/middleware'
import { listProviderIds, providerRegistry } from '../oauth/providers'

// ---------------------------------------------------------------------------
// Documentation defaults
//
// These prefill Swagger's "Try it out" so it is runnable without typing
// anything. They never affect runtime behaviour.
//
// Nothing here hard-codes an origin: the callback URL depends on the branch
// (portless prefixes non-`main` hosts) and on whether the API is reached
// directly or through the frontend, so it is reported per-request as
// `callback_url` by `GET /providers` instead.
// ---------------------------------------------------------------------------

/**
 * References the `brokerApiKey` scheme registered in `src/index.ts`. Attaching
 * it is what puts the **Authorize** button in Swagger UI and makes its
 * generated curl include the bearer header. The callback route omits it.
 */
const brokerAuth = [{ brokerApiKey: [] }]

/** Where the browser lands after a successful connection, locally. */
const DEFAULT_RETURN_TO = 'https://frontend.localhost'

/** Example connection id shown in OpenAPI / Swagger. */
const EXAMPLE_CONNECTION_ID = 'swift-orchid-4821'

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
  401: errorResponse('Missing API key, or the connection needs reauthorizing'),
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
  middleware: [requireApiKey],
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
                supports_refresh: z.boolean(),
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
    'Returns the provider consent URL. Redirect the user there; the broker handles the callback and stores the tokens. Omit `connection_id` to have the broker mint one (`word-word-number`). Each connection id is one provider link.',
  middleware: [requireApiKey, withDatabase],
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
            scopes: z.array(z.string()).optional().openapi({
              description:
                'Overrides the configured scopes for this flow. Leave empty to use the provider defaults from <PROVIDER>_SCOPES or the registry -- Swagger otherwise prefills a literal ["string"], which would be sent to the provider verbatim.',
              default: [],
              example: [],
            }),
            // `default` here is OpenAPI documentation only -- it prefills
            // Swagger's "Try it out" body. Deliberately NOT a Zod `.default()`,
            // which would apply at runtime and hard-code localhost into every
            // deployed environment.
            return_to: z.url().optional().openapi({
              description:
                'Where the callback sends the browser once it finishes, with `?connected=<provider>` appended. Omit to receive the connection as JSON instead.',
              default: DEFAULT_RETURN_TO,
              example: DEFAULT_RETURN_TO,
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
  middleware: [withDatabase],
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
      description: 'Connection stored',
      content: {
        'application/json': {
          schema: z.object({
            connected: z.literal(true),
            connection: connectionSchema,
          }),
        },
      },
    },
    302: { description: 'Redirected back to `return_to`' },
    ...commonErrors,
  },
})

const listConnectionsRoute = createRoute({
  method: 'get',
  path: '/connections',
  summary: 'List connections',
  description: 'Returns every stored connection. Pass `provider` to filter.',
  middleware: [requireApiKey, withDatabase],
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
  middleware: [requireApiKey, withDatabase],
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
  path: '/connections/{connection_id}/token',
  summary: 'Get a currently-valid access token, refreshing if needed',
  middleware: [requireApiKey, withDatabase],
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
  summary: 'Forget a stored connection',
  middleware: [requireApiKey, withDatabase],
  security: brokerAuth,
  request: { params: connectionIdParamSchema },
  responses: {
    200: {
      description: 'Deletion result',
      content: {
        'application/json': {
          schema: z.object({ deleted: z.boolean() }),
        },
      },
    },
    ...commonErrors,
  },
})

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const oauthRoutes = new OpenAPIHono<BrokerContext>()

oauthRoutes.openapi(listProvidersRoute, (c) => {
  return c.json(
    {
      providers: listProviderIds().map((id) => {
        const definition = providerRegistry[id]

        return {
          id: definition.id,
          label: definition.label,
          configured: isProviderConfigured(c.env, id),
          // Derived from this request, so it stays correct across branches,
          // `pnpm dev` vs. `server dev`, and deployed environments.
          callback_url: resolveRedirectUri(c.env, c.req.url, id),
          scopes: definition.defaultScopes,
          supports_refresh: definition.supportsRefresh,
          uses_pkce: definition.usePkce,
        }
      }),
    },
    200,
  )
})

oauthRoutes.openapi(authorizeRoute, async (c) => {
  const { provider } = c.req.valid('param')
  const body = c.req.valid('json')

  const result = await startAuthorization(c.get('db'), c.env, {
    connectionId: body.connection_id,
    provider,
    redirectUri: resolveRedirectUri(c.env, c.req.url, provider),
    scopes: body.scopes,
    returnTo: body.return_to,
  })

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

oauthRoutes.openapi(callbackRoute, async (c) => {
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

  const { connection, returnTo } = await completeAuthorization(
    c.get('db'),
    c.env,
    { provider, code: query.code, state: query.state },
  )

  if (returnTo) {
    const destination = new URL(returnTo)
    destination.searchParams.set('connected', provider)
    return c.redirect(destination.toString(), 302)
  }

  return c.json(
    { connected: true, connection: serializeConnection(connection) },
    200,
  )
})

oauthRoutes.openapi(listConnectionsRoute, async (c) => {
  const { provider } = c.req.valid('query')
  const connections = await listConnections(c.get('db'), { provider })

  return c.json({ connections: connections.map(serializeConnection) }, 200)
})

oauthRoutes.openapi(getConnectionRoute, async (c) => {
  const { connection_id: connectionId } = c.req.valid('param')
  const connection = await getConnection(c.get('db'), connectionId)

  return c.json({ connection: serializeConnection(connection) }, 200)
})

oauthRoutes.openapi(tokenRoute, async (c) => {
  const { connection_id: connectionId } = c.req.valid('param')
  const token = await getAccessToken(c.get('db'), c.env, connectionId)

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

oauthRoutes.openapi(disconnectRoute, async (c) => {
  const { connection_id: connectionId } = c.req.valid('param')

  return c.json(
    { deleted: await deleteConnection(c.get('db'), connectionId) },
    200,
  )
})

oauthRoutes.onError((error, c) => {
  if (isBrokerError(error)) {
    return c.json(
      { error: { code: error.code, message: error.message } },
      error.status,
    )
  }

  console.error('oauth broker error', error)

  return c.json(
    { error: { code: 'internal_error', message: 'Unexpected broker error.' } },
    500,
  )
})
