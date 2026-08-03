import { swaggerUI } from '@hono/swagger-ui'
import { OpenAPIHono } from '@hono/zod-openapi'
import {
  createProviderRegistry,
  isProviderRegistry,
  type OAuthProvider,
  type ProviderRegistry,
} from '@hookfish/provider'
import type { ExecutionContext } from 'hono'
import { cors } from 'hono/cors'

import type { DatabaseInput } from './db/binding'
import type { BrokerContext } from './oauth/middleware'
import { createOAuthRoutes } from './routes/oauth'
import { statsRoutes } from './routes/stats'

export type HookfishProviders = Record<string, OAuthProvider> | ProviderRegistry

export type HookfishOptions<Bindings extends object = object> = {
  providers: HookfishProviders
  db: DatabaseInput<Bindings>
}

function normalizeProviders(providers: HookfishProviders): ProviderRegistry {
  return isProviderRegistry(providers)
    ? providers
    : createProviderRegistry(providers)
}

function createApiRoutes<Bindings extends object>(
  providers: ProviderRegistry,
  database: DatabaseInput<Bindings>,
) {
  const base = new OpenAPIHono<BrokerContext<Bindings>>()

  base.openAPIRegistry.registerComponent('securitySchemes', 'brokerApiKey', {
    type: 'http',
    scheme: 'bearer',
    description: 'Send BROKER_API_KEY as `Authorization: Bearer <key>`.',
  })

  return base
    .doc('/openapi.json', {
      openapi: '3.1.0',
      info: {
        title: 'Hookfish API',
        version: '0.0.0',
      },
      servers: [{ url: '/api' }],
    })
    .get('/', swaggerUI({ url: '/api/openapi.json' }))
    .use('/stats', cors())
    .route('/stats', statsRoutes)
    .use('/oauth/*', cors())
    .route('/oauth', createOAuthRoutes(providers, database))
}

export type AppType = ReturnType<typeof createApiRoutes>

/**
 * A self-contained Hookfish request handler.
 *
 * `fetch` is an instance property so it can be passed directly to Node,
 * Cloudflare Workers, or another Fetch-compatible host without rebinding it.
 */
export class Hookfish<Bindings extends object = object> {
  readonly providers: ProviderRegistry
  private readonly app: {
    fetch(
      request: Request,
      bindings?: Bindings | object,
      executionContext?: ExecutionContext,
    ): Response | Promise<Response>
  }

  constructor(options: HookfishOptions<Bindings>) {
    this.providers = normalizeProviders(options.providers)
    const api = createApiRoutes(this.providers, options.db)
    this.app = new OpenAPIHono<BrokerContext<Bindings>>().route('/api', api)
  }

  readonly fetch = (
    request: Request,
    bindings: Bindings | undefined = undefined,
    executionContext?: ExecutionContext,
  ): Response | Promise<Response> => {
    return this.app.fetch(request, bindings ?? {}, executionContext)
  }
}

export function isHookfish(value: unknown): value is Hookfish<object> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'fetch') === 'function' &&
    isProviderRegistry(Reflect.get(value, 'providers'))
  )
}

export type { Database, OAuthConnection, OAuthState } from './db/schema'
export {
  type DatabaseBinding,
  type DatabaseInput,
  defineDatabase,
} from './db/binding'
