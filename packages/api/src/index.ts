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

import { type DatabaseInput, migrateDatabase } from './db/binding'
import type { BrokerContext } from './oauth/middleware'
import { createCredentialRoutes } from './routes/credentials'
import { createOAuthRoutes } from './routes/oauth'
import { statsRoutes } from './routes/stats'

export type HookfishProviders = Record<string, OAuthProvider> | ProviderRegistry

export type HookfishOptions<Bindings extends object = object> = {
  providers: HookfishProviders
  db: DatabaseInput<Bindings>
  /** Serve the interactive Swagger UI at `/api`. The OpenAPI document remains available. @default true */
  swaggerUi?: boolean
  /** Fixed destination after a successful OAuth callback. Omit for the development completion page. */
  returnTo?: string
}

function normalizeProviders(providers: HookfishProviders): ProviderRegistry {
  return isProviderRegistry(providers)
    ? providers
    : createProviderRegistry(providers)
}

function createApiRoutes<Bindings extends object>(
  providers: ProviderRegistry,
  database: DatabaseInput<Bindings>,
  returnTo?: string,
  swaggerUi = true,
) {
  const base = new OpenAPIHono<BrokerContext<Bindings>>()

  base.openAPIRegistry.registerComponent('securitySchemes', 'brokerApiKey', {
    type: 'http',
    scheme: 'bearer',
    description: 'Send BROKER_API_KEY as `Authorization: Bearer <key>`.',
  })

  base.doc('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'Hookfish API',
      version: '0.0.0',
    },
    servers: [{ url: '/api' }],
  })

  if (swaggerUi) {
    base.get('/', swaggerUI({ url: '/api/openapi.json' }))
  }

  return base
    .use('/stats', cors())
    .route('/stats', statsRoutes)
    .route('/credentials', createCredentialRoutes(database))
    .use('/oauth/*', cors())
    .route('/oauth', createOAuthRoutes(providers, database, returnTo))
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
  readonly db: DatabaseInput<Bindings>
  readonly returnTo: string | undefined
  private readonly app: {
    fetch(
      request: Request,
      bindings?: Bindings | object,
      executionContext?: ExecutionContext,
    ): Response | Promise<Response>
  }

  constructor(options: HookfishOptions<Bindings>) {
    this.providers = normalizeProviders(options.providers)
    this.db = options.db
    this.returnTo = options.returnTo
    const api = createApiRoutes(
      this.providers,
      options.db,
      options.returnTo,
      options.swaggerUi,
    )
    this.app = new OpenAPIHono<BrokerContext<Bindings>>().route('/api', api)
  }

  readonly fetch = (
    request: Request,
    bindings: Bindings | undefined = undefined,
    executionContext?: ExecutionContext,
  ): Response | Promise<Response> => {
    return this.app.fetch(request, bindings ?? {}, executionContext)
  }

  readonly migrate = (bindings: Bindings): Promise<void> => {
    return migrateDatabase(this.db, bindings)
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

export {
  type DatabaseBinding,
  type DatabaseInput,
  defineDatabase,
  migrateDatabase,
} from './db/binding'
export type {
  Credential,
  Database,
  OAuthConnection,
  OAuthState,
} from './db/schema'
