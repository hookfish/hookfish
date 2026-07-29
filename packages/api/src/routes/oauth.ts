import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import type { OAuthConnection } from '../db/schema'
import {
  completeAuthorization,
  deleteConnection,
  getAccessToken,
  listConnections,
  startAuthorization,
} from '../oauth/broker'
import { requireEncryptionKey, resolveRedirectUri } from '../oauth/config'
import { isBrokerError } from '../oauth/errors'
import {
  type BrokerContext,
  requireApiKey,
  withDatabase,
} from '../oauth/middleware'
import {
  clientAuthSchema,
  createProvider,
  deleteProvider,
  findProviderRow,
  listProviderRows,
  providerIdSchema,
  serializeProvider,
  tokenRequestFormatSchema,
  updateProvider,
} from '../oauth/providers'

// ---------------------------------------------------------------------------
// Documentation defaults
//
// These describe the standalone `pnpm --filter @template/server dev` setup so
// Swagger's "Try it out" is runnable without typing anything. They never affect
// runtime behaviour -- the real redirect URI is derived per-request by
// `resolveRedirectUri`.
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
  404: errorResponse('Unknown provider or no connection for this group'),
  409: errorResponse('Provider id already exists'),
  500: errorResponse('Broker is misconfigured'),
  502: errorResponse('The provider rejected the token request'),
}

const providerParamSchema = z.object({
  provider: providerIdSchema.openapi({
    param: { name: 'provider', in: 'path' },
    example: 'notion',
  }),
})

const connectionGroupIdQuerySchema = z.object({
  connection_group_id: z
    .string()
    .min(1)
    .openapi({
      param: { name: 'connection_group_id', in: 'query' },
      example: 'group_123',
    }),
})

const providerSchema = z
  .object({
    id: z.string().openapi({ example: 'notion' }),
    label: z.string().openapi({ example: 'Notion' }),
    authorize_url: z
      .string()
      .openapi({ example: 'https://api.notion.com/v1/oauth/authorize' }),
    token_url: z
      .string()
      .openapi({ example: 'https://api.notion.com/v1/oauth/token' }),
    default_scopes: z.array(z.string()),
    scope_separator: z.string().openapi({ example: ' ' }),
    token_request_format: tokenRequestFormatSchema,
    client_auth: clientAuthSchema,
    use_pkce: z.boolean(),
    supports_refresh: z.boolean(),
    authorize_params: z.record(z.string(), z.string()),
    account_id_path: z.string().nullable(),
    account_label_path: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('OAuthProvider')

const createProviderBodySchema = z
  .object({
    id: providerIdSchema.openapi({ example: 'notion' }),
    label: z.string().min(1).openapi({ example: 'Notion' }),
    authorize_url: z
      .url()
      .openapi({ example: 'https://api.notion.com/v1/oauth/authorize' }),
    token_url: z
      .url()
      .openapi({ example: 'https://api.notion.com/v1/oauth/token' }),
    client_id: z.string().min(1).openapi({ example: 'your-client-id' }),
    client_secret: z.string().min(1).openapi({ example: 'your-client-secret' }),
    default_scopes: z.array(z.string()).optional().openapi({
      description: 'Scopes requested when authorize does not override them.',
      example: [],
    }),
    scope_separator: z.string().min(1).optional().openapi({
      description: 'How to join scopes on the authorize URL (space or comma).',
      example: ' ',
    }),
    token_request_format: tokenRequestFormatSchema.optional().openapi({
      description: 'JSON body (Notion) vs form-urlencoded (most providers).',
      example: 'json',
    }),
    client_auth: clientAuthSchema.optional().openapi({
      description:
        '`basic` sends credentials in Authorization; `body` sends them as form/json fields.',
      example: 'basic',
    }),
    use_pkce: z.boolean().optional().openapi({ example: false }),
    supports_refresh: z.boolean().optional().openapi({ example: false }),
    authorize_params: z
      .record(z.string(), z.string())
      .optional()
      .openapi({
        description: 'Extra query params on the authorize URL.',
        example: { owner: 'user' },
      }),
    account_id_path: z.string().nullable().optional().openapi({
      description:
        'Dot-path into the token response for a stable remote account id.',
      example: 'workspace_id',
    }),
    account_label_path: z.string().nullable().optional().openapi({
      description:
        'Dot-path into the token response for a human-readable account label.',
      example: 'workspace_name',
    }),
  })
  .openapi('CreateOAuthProvider')

const updateProviderBodySchema = createProviderBodySchema
  .omit({ id: true })
  .partial()
  .refine(
    (body) => Object.keys(body).length > 0,
    'Provide at least one field to update.',
  )
  .openapi('UpdateOAuthProvider')

const connectionSchema = z
  .object({
    provider: z.string().openapi({ example: 'notion' }),
    connection_group_id: z.string().openapi({ example: 'group_123' }),
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
    connection_group_id: connection.connectionGroupId,
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
  summary: 'List configured OAuth providers',
  description:
    'Providers are stored in the database and registered entirely over the API — no code or env changes.',
  middleware: [requireApiKey, withDatabase],
  security: brokerAuth,
  responses: {
    200: {
      description: 'Registered providers (credentials never included)',
      content: {
        'application/json': {
          schema: z.object({
            providers: z.array(providerSchema),
          }),
        },
      },
    },
    ...commonErrors,
  },
})

const createProviderRoute = createRoute({
  method: 'post',
  path: '/providers',
  summary: 'Register an OAuth provider',
  description:
    'Creates a provider row with encrypted client credentials. Immediately usable at `/api/oauth/{id}/authorize`.',
  middleware: [requireApiKey, withDatabase],
  security: brokerAuth,
  request: {
    body: {
      content: {
        'application/json': { schema: createProviderBodySchema },
      },
    },
  },
  responses: {
    201: {
      description: 'Provider created',
      content: {
        'application/json': {
          schema: z.object({ provider: providerSchema }),
        },
      },
    },
    ...commonErrors,
  },
})

const getProviderRoute = createRoute({
  method: 'get',
  path: '/providers/{provider}',
  summary: 'Get one provider (no secrets)',
  middleware: [requireApiKey, withDatabase],
  security: brokerAuth,
  request: { params: providerParamSchema },
  responses: {
    200: {
      description: 'Provider',
      content: {
        'application/json': {
          schema: z.object({ provider: providerSchema }),
        },
      },
    },
    ...commonErrors,
  },
})

const updateProviderRoute = createRoute({
  method: 'patch',
  path: '/providers/{provider}',
  summary: 'Update a provider',
  description:
    'Partial update. Omit `client_id` / `client_secret` to leave credentials unchanged.',
  middleware: [requireApiKey, withDatabase],
  security: brokerAuth,
  request: {
    params: providerParamSchema,
    body: {
      content: {
        'application/json': { schema: updateProviderBodySchema },
      },
    },
  },
  responses: {
    200: {
      description: 'Provider updated',
      content: {
        'application/json': {
          schema: z.object({ provider: providerSchema }),
        },
      },
    },
    ...commonErrors,
  },
})

const deleteProviderRoute = createRoute({
  method: 'delete',
  path: '/providers/{provider}',
  summary: 'Delete a provider',
  description:
    'Also deletes connections and in-flight authorization states for this provider id.',
  middleware: [requireApiKey, withDatabase],
  security: brokerAuth,
  request: { params: providerParamSchema },
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

const authorizeRoute = createRoute({
  method: 'post',
  path: '/{provider}/authorize',
  summary: 'Create a consent URL for a connection group',
  description:
    'Returns the provider consent URL. Redirect the end-user there; the broker handles the callback and stores the tokens under the connection group.',
  middleware: [requireApiKey, withDatabase],
  security: brokerAuth,
  request: {
    params: providerParamSchema,
    body: {
      content: {
        'application/json': {
          schema: z.object({
            connection_group_id: z
              .string()
              .min(1)
              .openapi({ example: 'group_123' }),
            scopes: z.array(z.string()).optional().openapi({
              description:
                'Overrides the provider default_scopes for this flow. Leave empty to use the defaults — Swagger otherwise prefills a literal ["string"], which would be sent to the provider verbatim.',
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
  request: { params: providerParamSchema, query: connectionGroupIdQuerySchema },
  responses: {
    200: {
      description: 'A token that is valid right now',
      content: {
        'application/json': {
          schema: z.object({
            provider: z.string(),
            connection_group_id: z.string(),
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
  summary: "List a connection group's connections",
  middleware: [requireApiKey, withDatabase],
  security: brokerAuth,
  request: { query: connectionGroupIdQuerySchema },
  responses: {
    200: {
      description: 'Connections for the group',
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
  request: { params: providerParamSchema, query: connectionGroupIdQuerySchema },
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

oauthRoutes.openapi(listProvidersRoute, async (c) => {
  const rows = await listProviderRows(c.get('db'))
  return c.json({ providers: rows.map(serializeProvider) }, 200)
})

oauthRoutes.openapi(createProviderRoute, async (c) => {
  const body = c.req.valid('json')
  const row = await createProvider(c.get('db'), requireEncryptionKey(c.env), {
    id: body.id,
    label: body.label,
    authorizeUrl: body.authorize_url,
    tokenUrl: body.token_url,
    clientId: body.client_id,
    clientSecret: body.client_secret,
    defaultScopes: body.default_scopes,
    scopeSeparator: body.scope_separator,
    tokenRequestFormat: body.token_request_format,
    clientAuth: body.client_auth,
    usePkce: body.use_pkce,
    supportsRefresh: body.supports_refresh,
    authorizeParams: body.authorize_params,
    accountIdPath: body.account_id_path,
    accountLabelPath: body.account_label_path,
  })

  return c.json({ provider: serializeProvider(row) }, 201)
})

oauthRoutes.openapi(getProviderRoute, async (c) => {
  const { provider } = c.req.valid('param')
  const row = await findProviderRow(c.get('db'), provider)

  if (!row) {
    return c.json(
      {
        error: {
          code: 'unknown_provider',
          message: `Unknown provider "${provider}".`,
        },
      },
      404,
    )
  }

  return c.json({ provider: serializeProvider(row) }, 200)
})

oauthRoutes.openapi(updateProviderRoute, async (c) => {
  const { provider } = c.req.valid('param')
  const body = c.req.valid('json')

  const row = await updateProvider(
    c.get('db'),
    requireEncryptionKey(c.env),
    provider,
    {
      label: body.label,
      authorizeUrl: body.authorize_url,
      tokenUrl: body.token_url,
      clientId: body.client_id,
      clientSecret: body.client_secret,
      defaultScopes: body.default_scopes,
      scopeSeparator: body.scope_separator,
      tokenRequestFormat: body.token_request_format,
      clientAuth: body.client_auth,
      usePkce: body.use_pkce,
      supportsRefresh: body.supports_refresh,
      authorizeParams: body.authorize_params,
      accountIdPath: body.account_id_path,
      accountLabelPath: body.account_label_path,
    },
  )

  return c.json({ provider: serializeProvider(row) }, 200)
})

oauthRoutes.openapi(deleteProviderRoute, async (c) => {
  const { provider } = c.req.valid('param')
  return c.json({ deleted: await deleteProvider(c.get('db'), provider) }, 200)
})

oauthRoutes.openapi(authorizeRoute, async (c) => {
  const { provider } = c.req.valid('param')
  const body = c.req.valid('json')

  const redirectUri =
    body.redirect_uri ?? resolveRedirectUri(c.env, c.req.url, provider)

  const result = await startAuthorization(c.get('db'), c.env, {
    connectionGroupId: body.connection_group_id,
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
  const { connection_group_id: connectionGroupId } = c.req.valid('query')

  const token = await getAccessToken(
    c.get('db'),
    c.env,
    connectionGroupId,
    provider,
  )

  return c.json(
    {
      provider: token.provider,
      connection_group_id: token.connectionGroupId,
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
  const { connection_group_id: connectionGroupId } = c.req.valid('query')
  const connections = await listConnections(c.get('db'), connectionGroupId)

  return c.json({ connections: connections.map(serializeConnection) }, 200)
})

oauthRoutes.openapi(disconnectRoute, async (c) => {
  const { provider } = c.req.valid('param')
  const { connection_group_id: connectionGroupId } = c.req.valid('query')

  return c.json(
    {
      deleted: await deleteConnection(c.get('db'), connectionGroupId, provider),
    },
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
