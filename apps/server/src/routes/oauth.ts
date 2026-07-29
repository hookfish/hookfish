import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import type { OAuthConnection } from '../db/schema'
import {
  completeAuthorization,
  deleteConnection,
  getAccessToken,
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
import { providerIds, providerRegistry } from '../oauth/providers'

// ---------------------------------------------------------------------------
// Documentation defaults
//
// These describe the local `pnpm dev` setup so Swagger's "Try it out" is
// runnable without typing anything. They never affect runtime behaviour --
// the real redirect URI is derived per-request by `resolveRedirectUri`.
// ---------------------------------------------------------------------------

const LOCAL_API_ORIGIN = 'http://localhost:8787'

/**
 * References the `brokerApiKey` scheme registered in `src/index.ts`. Attaching
 * it is what puts the **Authorize** button in Swagger UI and makes its
 * generated curl include the bearer header. The callback route omits it.
 */
const brokerAuth = [{ brokerApiKey: [] }]

/** Where the browser lands after a successful connection, locally. */
const DEFAULT_RETURN_TO = 'https://frontend.localhost'

/** The callback URL to register with a provider's developer console. */
function exampleCallbackUrl(provider: string): string {
  return `${LOCAL_API_ORIGIN}/api/oauth/${provider}/callback`
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
  401: errorResponse('Missing API key, or the connection needs reauthorizing'),
  404: errorResponse('Unknown provider or no connection for this user'),
  500: errorResponse('Broker is misconfigured'),
  502: errorResponse('The provider rejected the token request'),
}

const providerParamSchema = z.object({
  provider: z
    .string()
    .openapi({ param: { name: 'provider', in: 'path' }, example: 'notion' }),
})

const userIdQuerySchema = z.object({
  user_id: z
    .string()
    .min(1)
    .openapi({ param: { name: 'user_id', in: 'query' }, example: 'user_123' }),
})

const connectionSchema = z
  .object({
    provider: z.string().openapi({ example: 'notion' }),
    user_id: z.string().openapi({ example: 'user_123' }),
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
    provider: connection.provider,
    user_id: connection.userId,
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
  summary: 'Create a consent URL for a user',
  description:
    'Returns the provider consent URL. Redirect the user there; the broker handles the callback and stores the tokens.',
  middleware: [requireApiKey, withDatabase],
  security: brokerAuth,
  request: {
    params: providerParamSchema,
    body: {
      content: {
        'application/json': {
          schema: z.object({
            user_id: z.string().min(1).openapi({ example: 'user_123' }),
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
            redirect_uri: z
              .url()
              .optional()
              .openapi({
                description:
                  'Overrides the derived callback URL. Must match what the provider has registered, byte for byte. Defaults at runtime to `<OAUTH_REDIRECT_BASE_URL, or the request origin>/api/oauth/<provider>/callback`.',
                default: exampleCallbackUrl('notion'),
                example: exampleCallbackUrl('notion'),
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
  description: `Register this exact URL in the provider's developer console, one per provider -- locally that is \`${exampleCallbackUrl('notion')}\` for Notion, \`${exampleCallbackUrl('linear')}\` for Linear, and so on. Authenticated by the single-use \`state\` parameter rather than the broker API key.`,
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

const tokenRoute = createRoute({
  method: 'get',
  path: '/connections/{provider}/token',
  summary: 'Get a currently-valid access token, refreshing if needed',
  middleware: [requireApiKey, withDatabase],
  security: brokerAuth,
  request: { params: providerParamSchema, query: userIdQuerySchema },
  responses: {
    200: {
      description: 'A token that is valid right now',
      content: {
        'application/json': {
          schema: z.object({
            provider: z.string(),
            user_id: z.string(),
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

const listConnectionsRoute = createRoute({
  method: 'get',
  path: '/connections',
  summary: "List a user's connections",
  middleware: [requireApiKey, withDatabase],
  security: brokerAuth,
  request: { query: userIdQuerySchema },
  responses: {
    200: {
      description: 'Connections for the user',
      content: {
        'application/json': {
          schema: z.object({ connections: z.array(connectionSchema) }),
        },
      },
    },
    ...commonErrors,
  },
})

const disconnectRoute = createRoute({
  method: 'delete',
  path: '/connections/{provider}',
  summary: 'Forget a stored connection',
  middleware: [requireApiKey, withDatabase],
  security: brokerAuth,
  request: { params: providerParamSchema, query: userIdQuerySchema },
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
      providers: providerIds.map((id) => {
        const definition = providerRegistry[id]

        return {
          id: definition.id,
          label: definition.label,
          configured: isProviderConfigured(c.env, id),
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

  const redirectUri =
    body.redirect_uri ?? resolveRedirectUri(c.env, c.req.url, provider)

  const result = await startAuthorization(c.get('db'), c.env, {
    userId: body.user_id,
    provider,
    redirectUri,
    scopes: body.scopes,
    returnTo: body.return_to,
  })

  return c.json(
    {
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

oauthRoutes.openapi(tokenRoute, async (c) => {
  const { provider } = c.req.valid('param')
  const { user_id: userId } = c.req.valid('query')

  const token = await getAccessToken(c.get('db'), c.env, userId, provider)

  return c.json(
    {
      provider: token.provider,
      user_id: token.userId,
      access_token: token.accessToken,
      token_type: token.tokenType,
      scopes: token.scopes,
      expires_at: token.expiresAt?.toISOString() ?? null,
      refreshed: token.refreshed,
    },
    200,
  )
})

oauthRoutes.openapi(listConnectionsRoute, async (c) => {
  const { user_id: userId } = c.req.valid('query')
  const connections = await listConnections(c.get('db'), userId)

  return c.json({ connections: connections.map(serializeConnection) }, 200)
})

oauthRoutes.openapi(disconnectRoute, async (c) => {
  const { provider } = c.req.valid('param')
  const { user_id: userId } = c.req.valid('query')

  return c.json(
    { deleted: await deleteConnection(c.get('db'), userId, provider) },
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
