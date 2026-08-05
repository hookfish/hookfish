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
import type { ZodType } from 'zod'

import { type DatabaseInput, migrateDatabase } from './db/binding'
import { type BrokerConfig, resolveBrokerConfig } from './oauth/config'
import type { BrokerContext } from './oauth/middleware'
import { createAdminRoutes } from './routes/admin'
import { createOAuthRoutes } from './routes/oauth'
import { statsRoutes } from './routes/stats'

export type ProviderMap = Record<string, OAuthProvider>

export type ProviderFactory<Config extends object> = (
  config: Config,
) => ProviderMap | Promise<ProviderMap>

export type HookfishProviders<Config extends object = object> =
  | ProviderMap
  | ProviderRegistry
  | ProviderFactory<Config>

export type HookfishConfig<
  Bindings extends object = object,
  Config extends object = object,
> = {
  /** Application configuration parsed once and passed to a provider factory. */
  config: ZodType<Config>
  providers: HookfishProviders<Config>
  db: DatabaseInput<Bindings>
  /** Serve the interactive Swagger UI at `/api`. The OpenAPI document remains available. @default true */
  swaggerUi?: boolean
  /** Fixed destination after a successful OAuth callback. Omit for the development completion page. */
  returnTo?: string
}

function normalizeProviders(providers: ProviderMap | ProviderRegistry) {
  return isProviderRegistry(providers)
    ? providers
    : createProviderRegistry(providers)
}

async function resolveProviderSource<Config extends object>(
  source: HookfishProviders<Config>,
  config: Config,
): Promise<ProviderRegistry> {
  const providers = typeof source === 'function' ? await source(config) : source
  return normalizeProviders(providers)
}

export function defineHookfishConfig<
  Bindings extends object = object,
  Config extends object = object,
>(config: HookfishConfig<Bindings, Config>): HookfishConfig<Bindings, Config> {
  return config
}

function createApiRoutes<Bindings extends object>(
  providers: ProviderRegistry,
  resolveConfig: () => BrokerConfig,
  database: DatabaseInput<Bindings>,
  returnTo?: string,
  swaggerUi = true,
) {
  const base = new OpenAPIHono<BrokerContext<Bindings>>()

  base.openAPIRegistry.registerComponent('securitySchemes', 'brokerApiKey', {
    type: 'http',
    scheme: 'bearer',
    description:
      'Send BROKER_API_KEY for root access, or a named scoped token minted by POST /admin/tokens.',
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
    .use('/admin/*', cors())
    .route('/admin', createAdminRoutes(resolveConfig, database))
    .use('/oauth/*', cors())
    .route(
      '/oauth',
      createOAuthRoutes(providers, resolveConfig, database, returnTo),
    )
}

export type AppType = ReturnType<typeof createApiRoutes>

/**
 * A self-contained Hookfish request handler.
 *
 * `fetch` is an instance property so it can be passed directly to Node,
 * Cloudflare Workers, or another Fetch-compatible host without rebinding it.
 */
export class Hookfish<
  Bindings extends object = object,
  Config extends object = object,
> {
  readonly config: Config
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

  private constructor(
    options: HookfishConfig<Bindings, Config>,
    config: Config,
    providers: ProviderRegistry,
  ) {
    this.config = config
    let brokerConfig: BrokerConfig | undefined
    const resolveConfig = () => {
      brokerConfig ??= resolveBrokerConfig(this.config)
      return brokerConfig
    }
    this.providers = providers
    this.db = options.db
    this.returnTo = options.returnTo
    const api = createApiRoutes(
      providers,
      resolveConfig,
      options.db,
      options.returnTo,
      options.swaggerUi,
    )
    this.app = new OpenAPIHono<BrokerContext<Bindings>>().route('/api', api)
  }

  static async init<
    Bindings extends object = object,
    Config extends object = object,
  >(
    options: HookfishConfig<Bindings, Config>,
  ): Promise<Hookfish<Bindings, Config>> {
    const config = options.config.parse({})
    const providers = await resolveProviderSource(options.providers, config)
    return new Hookfish(options, config, providers)
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

export function isHookfish(value: unknown): value is Hookfish<object, object> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'fetch') === 'function' &&
    isProviderRegistry(Reflect.get(value, 'providers'))
  )
}

export { z } from 'zod'
export {
  type DatabaseBinding,
  type DatabaseInput,
  defineDatabase,
  migrateDatabase,
} from './db/binding'
export type {
  BrokerAccessToken,
  Database,
  OAuthConnection,
  OAuthState,
} from './db/schema'
