import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import {
  createCredential,
  deleteCredential,
  getCredential,
  listCredentials,
  resolveCredential,
  updateCredential,
} from '../credentials/broker'
import type { DatabaseInput } from '../db/binding'
import type { Credential } from '../db/schema'
import { isBrokerError } from '../oauth/errors'
import {
  type BrokerContext,
  requireApiKey,
  withDatabase,
} from '../oauth/middleware'

const brokerAuth = [{ brokerApiKey: [] }]

const credentialIdParams = z.object({
  credential_id: z.uuid().openapi({
    param: { name: 'credential_id', in: 'path' },
  }),
})

const credentialInput = z.discriminatedUnion('kind', [
  z.object({
    name: z.string().trim().min(1).max(200),
    kind: z.literal('headers'),
    headers: z
      .record(z.string(), z.string().max(16_384))
      .refine((headers) => Object.keys(headers).length <= 50, {
        message: 'A credential can contain at most 50 headers.',
      })
      .refine((headers) => JSON.stringify(headers).length <= 65_536, {
        message: 'A header credential can contain at most 64 KiB.',
      }),
  }),
  z.object({
    name: z.string().trim().min(1).max(200),
    kind: z.literal('opaque'),
    value: z.string().min(1).max(65_536),
  }),
])

const credentialSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: z.enum(['headers', 'opaque']),
  fields: z.array(z.string()),
  created_at: z.string(),
  updated_at: z.string(),
  last_used_at: z.string().nullable(),
})

const resolvedPayload = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('headers'),
    headers: z.record(z.string(), z.string()),
  }),
  z.object({ kind: z.literal('opaque'), value: z.string() }),
])

const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
})

function errorResponse(description: string) {
  return {
    description,
    content: { 'application/json': { schema: errorSchema } },
  }
}

const commonErrors = {
  400: errorResponse('Invalid credential'),
  401: errorResponse('Missing or invalid broker API key'),
  404: errorResponse('Credential does not exist for this owner'),
  500: errorResponse('Credential vault is misconfigured'),
}

type SerializedCredential = z.infer<typeof credentialSchema>

function serializeCredential(credential: Credential): SerializedCredential {
  const kind: string = credential.kind
  if (kind !== 'headers' && kind !== 'opaque') {
    throw new Error(`Unsupported stored credential kind: ${kind}`)
  }

  return {
    id: credential.id,
    name: credential.name,
    kind,
    fields: credential.fields,
    created_at: credential.createdAt.toISOString(),
    updated_at: credential.updatedAt.toISOString(),
    last_used_at: credential.lastUsedAt?.toISOString() ?? null,
  }
}

const createRouteDefinition = createRoute({
  method: 'post',
  path: '/',
  summary: 'Store an encrypted credential',
  security: brokerAuth,
  request: {
    body: { content: { 'application/json': { schema: credentialInput } } },
  },
  responses: {
    201: {
      description: 'Credential metadata; secret values are omitted',
      content: {
        'application/json': {
          schema: z.object({ credential: credentialSchema }),
        },
      },
    },
    ...commonErrors,
  },
})

const listRouteDefinition = createRoute({
  method: 'get',
  path: '/',
  summary: 'List credential metadata for the configured owner',
  security: brokerAuth,
  request: {
    query: z.object({ kind: z.enum(['headers', 'opaque']).optional() }),
  },
  responses: {
    200: {
      description: 'Credentials; secret values are never included',
      content: {
        'application/json': {
          schema: z.object({ credentials: z.array(credentialSchema) }),
        },
      },
    },
    ...commonErrors,
  },
})

const getRouteDefinition = createRoute({
  method: 'get',
  path: '/{credential_id}',
  summary: 'Get credential metadata',
  security: brokerAuth,
  request: { params: credentialIdParams },
  responses: {
    200: {
      description: 'Credential metadata; secret values are omitted',
      content: {
        'application/json': {
          schema: z.object({ credential: credentialSchema }),
        },
      },
    },
    ...commonErrors,
  },
})

const updateRouteDefinition = createRoute({
  method: 'put',
  path: '/{credential_id}',
  summary: 'Replace and re-encrypt a credential',
  security: brokerAuth,
  request: {
    params: credentialIdParams,
    body: { content: { 'application/json': { schema: credentialInput } } },
  },
  responses: {
    200: {
      description: 'Updated credential metadata',
      content: {
        'application/json': {
          schema: z.object({ credential: credentialSchema }),
        },
      },
    },
    ...commonErrors,
  },
})

const resolveRouteDefinition = createRoute({
  method: 'post',
  path: '/{credential_id}/resolve',
  summary: 'Resolve a credential for trusted server-side use',
  description:
    'This is the only endpoint that returns plaintext. Responses are marked no-store and update last_used_at.',
  security: brokerAuth,
  request: { params: credentialIdParams },
  responses: {
    200: {
      description: 'Plaintext credential for immediate server-side use',
      content: {
        'application/json': {
          schema: z.object({
            credential: credentialSchema,
            payload: resolvedPayload,
          }),
        },
      },
    },
    ...commonErrors,
  },
})

const deleteRouteDefinition = createRoute({
  method: 'delete',
  path: '/{credential_id}',
  summary: 'Delete a credential',
  security: brokerAuth,
  request: { params: credentialIdParams },
  responses: {
    200: {
      description: 'Deletion result',
      content: {
        'application/json': { schema: z.object({ deleted: z.boolean() }) },
      },
    },
    ...commonErrors,
  },
})

export function createCredentialRoutes<Bindings extends object>(
  database: DatabaseInput<Bindings>,
) {
  const routes = new OpenAPIHono<BrokerContext<Bindings>>()
  const authenticate = requireApiKey<Bindings>()
  const connectDatabase = withDatabase(database)
  routes.use('*', authenticate, connectDatabase)

  routes.openapi(createRouteDefinition, async (c) => {
    const credential = await createCredential(
      c.get('db'),
      c.env,
      c.req.valid('json'),
    )
    return c.json({ credential: serializeCredential(credential) }, 201)
  })

  routes.openapi(listRouteDefinition, async (c) => {
    const { kind } = c.req.valid('query')
    const found = await listCredentials(c.get('db'), c.env, kind)
    return c.json({ credentials: found.map(serializeCredential) }, 200)
  })

  routes.openapi(getRouteDefinition, async (c) => {
    const { credential_id: id } = c.req.valid('param')
    const credential = await getCredential(c.get('db'), c.env, id)
    return c.json({ credential: serializeCredential(credential) }, 200)
  })

  routes.openapi(updateRouteDefinition, async (c) => {
    const { credential_id: id } = c.req.valid('param')
    const credential = await updateCredential(
      c.get('db'),
      c.env,
      id,
      c.req.valid('json'),
    )
    return c.json({ credential: serializeCredential(credential) }, 200)
  })

  routes.openapi(resolveRouteDefinition, async (c) => {
    const { credential_id: id } = c.req.valid('param')
    const result = await resolveCredential(c.get('db'), c.env, id)
    c.header('Cache-Control', 'no-store')
    c.header('Pragma', 'no-cache')
    return c.json(
      {
        credential: serializeCredential(result.credential),
        payload: result.payload,
      },
      200,
    )
  })

  routes.openapi(deleteRouteDefinition, async (c) => {
    const { credential_id: id } = c.req.valid('param')
    return c.json(
      { deleted: await deleteCredential(c.get('db'), c.env, id) },
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

    console.error('credential vault error', error)
    return c.json(
      { error: { code: 'internal_error', message: 'Unexpected vault error.' } },
      500,
    )
  })

  return routes
}
