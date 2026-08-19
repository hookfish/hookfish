import { swaggerUI } from '@hono/swagger-ui'
import { OpenAPIHono } from '@hono/zod-openapi'
import {
  type ConnectionProvider,
  type ProviderRegistry,
} from '@hookfish/provider'
import { Hono, type ExecutionContext } from 'hono'
import { cors } from 'hono/cors'

import { type DatabaseInput, migrateDatabase } from './db/binding.js'
import type { HookfishEventHandler } from './events.js'
import type { BrokerContext } from './oauth/middleware.js'
import {
  type BoundProviderSource,
  createProviderResolver,
  materializeProviderRegistry,
  type ProviderInput,
} from './provider-source.js'
import { createAdminRoutes } from './routes/admin.js'
import { createAccessRoutes } from './routes/access.js'
import { createConnectionRoutes } from './routes/connections.js'
import { statsRoutes } from './routes/stats.js'

export type { ProviderFactory, ProviderMap } from './provider-source.js'

export type HookfishProviders<Bindings extends object = object> =
  ProviderInput<Bindings>

export type HookfishConfig<Bindings extends object = object> = {
  /** Fixed providers, a lazy provider source, or a request-aware factory. */
  providers: HookfishProviders<Bindings>
  /** Default database binding. A runtime host may override it in `HookfishServer.init`. */
  db: DatabaseInput<Bindings>
  /** Serve raw API OpenAPI JSON and Swagger UI. @default true */
  includeSwagger?: boolean
  /** Fixed destination after a successful OAuth callback. Omit for the development completion page. */
  returnTo?: string
  /** Origins allowed by the per-authorization `return_to` option. */
  trustedOrigins?: readonly string[]
  /** Exceptional exact origins allowed to call the raw server API. @default [] */
  rawApiOrigins?: readonly string[]
  /** Best-effort lifecycle and audit event handler. */
  onEvent?: HookfishEventHandler
}

export function defineHookfishConfig<Bindings extends object = object>(
  config: HookfishConfig<Bindings>,
): HookfishConfig<Bindings> {
  return config
}

function validateHttpUrl(name: string, value: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} must be an absolute URL.`)
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${name} must use http or https.`)
  }
}

function validateExactOrigins(name: string, origins: readonly string[]): void {
  for (const origin of origins) {
    if (origin === '*') throw new Error(`${name} does not allow "*".`)
    validateHttpUrl(`Each ${name} entry`, origin)
    if (new URL(origin).origin !== origin) {
      throw new Error(`${name} entries must be exact origins without paths.`)
    }
  }
}

function validateHookfishOptions(
  options: Pick<
    HookfishConfig,
    'returnTo' | 'trustedOrigins' | 'rawApiOrigins'
  >,
): void {
  if (options.returnTo) validateHttpUrl('returnTo', options.returnTo)
  validateExactOrigins('trustedOrigins', options.trustedOrigins ?? [])
  validateExactOrigins('rawApiOrigins', options.rawApiOrigins ?? [])
}

function createApiRoutes<Bindings extends object>(
  resolveProviders: (bindings: Bindings) => Promise<BoundProviderSource>,
  database: DatabaseInput<Bindings>,
  options: Pick<
    HookfishConfig<Bindings>,
    'returnTo' | 'trustedOrigins' | 'rawApiOrigins' | 'onEvent'
  >,
  includeSwagger = true,
) {
  const base = new OpenAPIHono<BrokerContext<Bindings>>()

  base.openAPIRegistry.registerComponent('securitySchemes', 'brokerApiKey', {
    type: 'http',
    scheme: 'bearer',
    description:
      'Send HOOKFISH_API_KEY for root access, or a named scoped token minted by POST /admin/tokens.',
  })

  if (includeSwagger) {
    base.get('/openapi.json', (context) =>
      context.json(
        base.getOpenAPI31Document({
          openapi: '3.1.0',
          info: {
            title: 'Hookfish API',
            version: '0.0.0',
          },
          servers: [{ url: '/api' }],
        }),
      ),
    )
    base.get('/docs', swaggerUI({ url: '/api/openapi.json' }))
  }

  const rawOrigins = options.rawApiOrigins ?? []
  if (rawOrigins.length > 0) {
    const rawCors = cors({
      credentials: false,
      origin: (origin) => (rawOrigins.includes(origin) ? origin : ''),
    })
    base.use('/access', rawCors)
    base.use('/stats', rawCors)
    base.use('/admin/*', rawCors)
    base.use('/connections', rawCors)
    base.use('/connections/*', rawCors)
  }

  const api = base
    .route('/access', createAccessRoutes(database))
    .route('/stats', statsRoutes)
    .route('/admin', createAdminRoutes(database, options.onEvent))
    .route(
      '/connections',
      createConnectionRoutes(resolveProviders, database, {
        ...options,
      }),
    )

  return api
}

/**
 * Build the complete server contract used to generate the first-party SDK.
 */
export async function createHookfishOpenAPIDocument(): Promise<unknown> {
  const unavailableDatabase: DatabaseInput<object> = {
    async getDatabase() {
      throw new Error('The OpenAPI document does not execute database access.')
    },
  }
  const unavailableProviders = async (): Promise<BoundProviderSource> => {
    throw new Error('The OpenAPI document does not resolve providers.')
  }
  const api = createApiRoutes(unavailableProviders, unavailableDatabase, {})
  const response = await api.request('/openapi.json')
  if (!response.ok) {
    throw new Error(`Failed to create Hookfish OpenAPI: ${response.status}`)
  }
  return response.json()
}

export type AppType = ReturnType<typeof createApiRoutes>

function optionalExecutionContext(context: {
  readonly executionCtx: ExecutionContext
}): ExecutionContext | undefined {
  try {
    return context.executionCtx
  } catch {
    return undefined
  }
}

/**
 * A self-contained Hookfish Hono application and request handler.
 *
 * Pass the instance directly to `app.route('/', hookfish)` to embed Hookfish in
 * a larger Hono application, or pass `fetch` to any Fetch-compatible host.
 */
export class HookfishServer<Bindings extends object = object> extends Hono<{
  Bindings: Bindings
}> {
  readonly db: DatabaseInput<Bindings>
  readonly includeSwagger: boolean
  readonly returnTo: string | undefined
  private readonly resolveProviders: (
    bindings: Bindings,
  ) => Promise<BoundProviderSource>
  private constructor(
    options: HookfishConfig<Bindings>,
    resolveProviders: (bindings: Bindings) => Promise<BoundProviderSource>,
  ) {
    super()
    this.resolveProviders = resolveProviders
    this.db = options.db
    this.includeSwagger = options.includeSwagger ?? true
    this.returnTo = options.returnTo
    const api = createApiRoutes(
      resolveProviders,
      this.db,
      options,
      this.includeSwagger,
    )
    const rawApp = new OpenAPIHono<BrokerContext<Bindings>>().route('/api', api)
    const handleRequest = (context: {
      readonly env: Bindings
      readonly executionCtx: ExecutionContext
      readonly req: { readonly raw: Request }
    }) =>
      rawApp.fetch(
        context.req.raw,
        context.env ?? {},
        optionalExecutionContext(context),
      )

    this.all('/api', handleRequest)
    this.all('/api/*', handleRequest)
  }

  static async init<Bindings extends object = object>(
    options: HookfishConfig<Bindings>,
  ): Promise<HookfishServer<Bindings>> {
    validateHookfishOptions(options)
    const resolveProviders = createProviderResolver(options.providers)
    return new HookfishServer<Bindings>(options, resolveProviders)
  }

  /** Resolve one provider without listing a lazy source. */
  readonly getProvider = async (
    providerId: string,
    bindings: Bindings,
  ): Promise<ConnectionProvider | undefined> => {
    return (await this.resolveProviders(bindings)).getProvider(providerId)
  }

  /** Materialize the configured provider listing as an in-memory registry. */
  readonly getProviders = async (
    bindings: Bindings,
  ): Promise<ProviderRegistry> => {
    return materializeProviderRegistry(await this.resolveProviders(bindings))
  }

  readonly migrate = (bindings: Bindings): Promise<void> => {
    return migrateDatabase(this.db, bindings)
  }
}

/** Create a Hookfish raw API server. */
export function createHookfish<Bindings extends object = object>(
  options: HookfishConfig<Bindings>,
): Promise<HookfishServer<Bindings>> {
  return HookfishServer.init(options)
}

export function isHookfish(value: unknown): value is HookfishServer<object> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'fetch') === 'function' &&
    typeof Reflect.get(value, 'getProviders') === 'function'
  )
}

export {
  createProviderSource,
  type ProviderSource,
  type ProviderSourceEntry,
  type ProviderSourceListResult,
  type ProviderSourceQuery,
} from '@hookfish/provider'
export { z } from 'zod'
export {
  type DatabaseBinding,
  type DatabaseInput,
  defineDatabase,
  migrateDatabase,
} from './db/binding.js'
export type {
  AccessGrant,
  BrokerAccessToken,
  Connection,
  ConnectionFilter,
  ConnectionSummary,
  ConnectionUpdate,
  Database,
  DatabaseResult,
  NewBrokerAccessToken,
  NewConnection,
  NewOAuthState,
  OAuthState,
  OAuthStateUpdate,
} from './db/types.js'
export type { HookfishEvent, HookfishEventHandler } from './events.js'
