import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import type { DatabaseInput } from '../db/binding'
import { emitHookfishEvent, type HookfishEventHandler } from '../events'
import {
  assertConnectionAccess,
  assertNamespaceAccess,
} from '../oauth/access-token'
import { resolveBrokerConfig } from '../oauth/config'
import { BrokerError, isBrokerError } from '../oauth/errors'
import {
  type BrokerContext,
  requireApiKey,
  withDatabase,
} from '../oauth/middleware'
import {
  deleteVaultSecret,
  getVaultSecret,
  listVaultSecrets,
  MAX_SECRET_PATH_LENGTH,
  normalizeSecretPath,
  putVaultSecret,
} from '../vault'

const brokerAuth = [{ brokerApiKey: [] }]
const pathParam = z.object({
  secret_path: z.string().min(1).max(MAX_SECRET_PATH_LENGTH),
})
const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
})
const errors = {
  400: {
    description: 'Invalid secret path or value',
    content: { 'application/json': { schema: errorSchema } },
  },
  401: {
    description: 'Missing or invalid broker credential',
    content: { 'application/json': { schema: errorSchema } },
  },
  403: {
    description: 'Credential cannot access this secret path',
    content: { 'application/json': { schema: errorSchema } },
  },
  404: {
    description: 'Secret not found',
    content: { 'application/json': { schema: errorSchema } },
  },
  500: {
    description: 'Broker configuration error',
    content: { 'application/json': { schema: errorSchema } },
  },
}

const secretMetadataSchema = z.object({
  path: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
})

const listRoute = createRoute({
  method: 'get',
  path: '/secrets',
  operationId: 'secrets.list',
  summary: 'List secret metadata',
  description: 'Lists accessible paths and timestamps, never secret values.',
  security: brokerAuth,
  request: {
    query: z.object({
      path_prefix: z.string().min(1).max(MAX_SECRET_PATH_LENGTH).optional(),
    }),
  },
  responses: {
    200: {
      description: 'Secret metadata',
      content: {
        'application/json': {
          schema: z.object({ secrets: z.array(secretMetadataSchema) }),
        },
      },
    },
    ...errors,
  },
})

const putRoute = createRoute({
  method: 'put',
  path: '/secrets/{secret_path}',
  operationId: 'secrets.put',
  summary: 'Store an encrypted secret',
  security: brokerAuth,
  request: {
    params: pathParam,
    body: {
      content: {
        'application/json': {
          schema: z.object({ value: z.string().min(1).max(65_536) }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Secret stored',
      content: {
        'application/json': {
          schema: z.object({ secret: secretMetadataSchema }),
        },
      },
    },
    ...errors,
  },
})

const getRoute = createRoute({
  method: 'get',
  path: '/secrets/{secret_path}',
  operationId: 'secrets.get',
  summary: 'Retrieve a decrypted secret',
  description:
    'Server-only operation. This route is never exposed through the browser-safe client facade.',
  security: brokerAuth,
  request: { params: pathParam },
  responses: {
    200: {
      description: 'Decrypted secret',
      content: {
        'application/json': {
          schema: z.object({ path: z.string(), value: z.string() }),
        },
      },
    },
    ...errors,
  },
})

const deleteRoute = createRoute({
  method: 'delete',
  path: '/secrets/{secret_path}',
  operationId: 'secrets.delete',
  summary: 'Delete a secret',
  security: brokerAuth,
  request: { params: pathParam },
  responses: {
    200: {
      description: 'Deletion result',
      content: {
        'application/json': {
          schema: z.object({ path: z.string(), deleted: z.boolean() }),
        },
      },
    },
    ...errors,
  },
})

const putRuntimeRoute = createRoute({
  ...putRoute,
  path: '/secrets/:secret_path{.+}',
  hide: true,
})
const getRuntimeRoute = createRoute({
  ...getRoute,
  path: '/secrets/:secret_path{.+}',
  hide: true,
})
const deleteRuntimeRoute = createRoute({
  ...deleteRoute,
  path: '/secrets/:secret_path{.+}',
  hide: true,
})

type SecretRouteOptions = {
  onEvent?: HookfishEventHandler
}

function serializeMetadata(secret: {
  path: string
  createdAt: Date
  updatedAt: Date
}) {
  return {
    path: secret.path,
    created_at: secret.createdAt.toISOString(),
    updated_at: secret.updatedAt.toISOString(),
  }
}

export function createSecretRoutes<Bindings extends object>(
  database: DatabaseInput<Bindings>,
  options: SecretRouteOptions,
) {
  const routes = new OpenAPIHono<BrokerContext<Bindings>>()
  const authenticate = requireApiKey<Bindings>()
  const connectDatabase = withDatabase(database)
  routes.use('/secrets', connectDatabase, authenticate)
  routes.use('/secrets/*', connectDatabase, authenticate)
  routes.openAPIRegistry.registerPath(putRoute)
  routes.openAPIRegistry.registerPath(getRoute)
  routes.openAPIRegistry.registerPath(deleteRoute)

  const listApi = routes.openapi(listRoute, async (c) => {
    const { path_prefix: requestedPrefix } = c.req.valid('query')
    if (requestedPrefix) {
      const normalized = normalizeSecretPath(requestedPrefix)
      assertNamespaceAccess(c.get('accessGrant'), normalized)
    } else if (!c.get('accessGrant').scopes.includes('**')) {
      throw new BrokerError(
        400,
        'secret_path_prefix_required',
        'A scoped broker access token must provide a path_prefix within its scope.',
      )
    }
    const secrets = await listVaultSecrets(c.get('db'), {
      prefix: requestedPrefix,
      scopes: c.get('accessGrant').scopes,
    })
    c.header('Cache-Control', 'no-store')
    return c.json({ secrets: secrets.map(serializeMetadata) }, 200)
  })

  const putApi = listApi.openapi(putRuntimeRoute, async (c) => {
    const path = normalizeSecretPath(c.req.valid('param').secret_path)
    assertConnectionAccess(c.get('accessGrant'), path)
    const stored = await putVaultSecret(
      c.get('db'),
      resolveBrokerConfig(c.env),
      path,
      c.req.valid('json').value,
    )
    await emitHookfishEvent(options.onEvent, {
      type: 'secret.stored',
      occurredAt: new Date(),
      secretPath: path,
    })
    c.header('Cache-Control', 'no-store')
    return c.json({ secret: serializeMetadata(stored) }, 200)
  })

  const getApi = putApi.openapi(getRuntimeRoute, async (c) => {
    const path = normalizeSecretPath(c.req.valid('param').secret_path)
    assertConnectionAccess(c.get('accessGrant'), path)
    const secret = await getVaultSecret(
      c.get('db'),
      resolveBrokerConfig(c.env),
      path,
    )
    await emitHookfishEvent(options.onEvent, {
      type: 'secret.retrieved',
      occurredAt: new Date(),
      secretPath: path,
    })
    c.header('Cache-Control', 'no-store')
    c.header('Pragma', 'no-cache')
    return c.json(secret, 200)
  })

  const deleteApi = getApi.openapi(deleteRuntimeRoute, async (c) => {
    const path = normalizeSecretPath(c.req.valid('param').secret_path)
    assertConnectionAccess(c.get('accessGrant'), path)
    const deleted = await deleteVaultSecret(c.get('db'), path)
    if (deleted) {
      await emitHookfishEvent(options.onEvent, {
        type: 'secret.deleted',
        occurredAt: new Date(),
        secretPath: path,
      })
    }
    c.header('Cache-Control', 'no-store')
    return c.json({ path, deleted }, 200)
  })

  deleteApi.onError((error, c) => {
    if (isBrokerError(error)) {
      return c.json(
        { error: { code: error.code, message: error.message } },
        error.status,
      )
    }
    console.error('secret vault error', error)
    return c.json(
      {
        error: { code: 'internal_error', message: 'Unexpected broker error.' },
      },
      500,
    )
  })
  return deleteApi
}
