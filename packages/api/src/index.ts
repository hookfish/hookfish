import { swaggerUI } from '@hono/swagger-ui'
import { OpenAPIHono } from '@hono/zod-openapi'
import {
  type ConnectionProvider,
  type ProviderRegistry,
} from '@hookfish/provider'
import { type ExecutionContext, Hono } from 'hono'
import { cors } from 'hono/cors'

import type { ApplicationAuthProvider } from './application-auth.js'
import type { HookfishBackend } from './backend.js'
import { createHookfishBackend, type HookfishBackendOptions } from './client.js'
import { type DatabaseInput, migrateDatabase } from './db/binding.js'
import type { HookfishEventHandler } from './events.js'
import { requireBrokerApiKey, resolveBrokerConfig } from './oauth/config.js'
import type { BrokerContext } from './oauth/middleware.js'
import {
  type BoundProviderSource,
  createProviderResolver,
  materializeProviderRegistry,
  type ProviderInput,
} from './provider-source.js'
import { createAdminRoutes } from './routes/admin.js'
import { createBackendConnectionRoutes } from './routes/backend-connections.js'
import { createConnectionRoutes } from './routes/connections.js'
import { statsRoutes } from './routes/stats.js'

export type { ProviderFactory, ProviderMap } from './provider-source.js'

export type HookfishProviders<Bindings extends object = object> =
  ProviderInput<Bindings>

type HookfishCommonConfig<Bindings extends object = object> = {
  /** Application authentication and tenant authorization for `/api/client`. */
  auth?: ApplicationAuthProvider<Bindings>
  /** Additional exact origins allowed to call `/api/client`. Same-origin is always allowed. */
  clientOrigins?: readonly string[]
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

export type HookfishSelfHostedConfig<Bindings extends object = object> =
  HookfishCommonConfig<Bindings> & {
    /** Fixed providers, a lazy provider source, or a request-aware factory. */
    providers: HookfishProviders<Bindings>
    /** Default database binding. A runtime host may override it in `HookfishServer.init`. */
    db: DatabaseInput<Bindings>
    backend?: never
  }

export type HookfishManagedConfig<Bindings extends object = object> =
  HookfishCommonConfig<Bindings> & {
    /** OAuth connection lifecycle supplied by a managed service such as Arcade. */
    backend: HookfishBackend<Bindings>
    db?: never
    providers?: never
  }

export type HookfishConfig<Bindings extends object = object> =
  | HookfishSelfHostedConfig<Bindings>
  | HookfishManagedConfig<Bindings>

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
    'returnTo' | 'trustedOrigins' | 'clientOrigins' | 'rawApiOrigins'
  >,
): void {
  if (options.returnTo) validateHttpUrl('returnTo', options.returnTo)
  validateExactOrigins('trustedOrigins', options.trustedOrigins ?? [])
  validateExactOrigins('clientOrigins', options.clientOrigins ?? [])
  validateExactOrigins('rawApiOrigins', options.rawApiOrigins ?? [])
}

type ApiRouteOptions<Bindings extends object> = Pick<
  HookfishConfig<Bindings>,
  'returnTo' | 'trustedOrigins' | 'rawApiOrigins' | 'onEvent'
>

function createSelfHostedApiRoutes<Bindings extends object>(
  base: OpenAPIHono<BrokerContext<Bindings>>,
  resolveProviders: (bindings: Bindings) => Promise<BoundProviderSource>,
  database: DatabaseInput<Bindings>,
  options: ApiRouteOptions<Bindings>,
) {
  return base
    .route('/stats', statsRoutes)
    .route('/admin', createAdminRoutes(database, options.onEvent))
    .route(
      '/connections',
      createConnectionRoutes(resolveProviders, database, options),
    )
}

function createApiRoutes<Bindings extends object>(
  resolveProviders:
    | ((bindings: Bindings) => Promise<BoundProviderSource>)
    | undefined,
  database: DatabaseInput<Bindings> | undefined,
  backend: HookfishBackend<Bindings> | undefined,
  options: ApiRouteOptions<Bindings>,
  includeSwagger = true,
  backendRootApiKey?: HookfishRuntime<Bindings>['rootApiKey'],
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
    base.use('/stats', rawCors)
    base.use('/admin/*', rawCors)
    base.use('/connections', rawCors)
    base.use('/connections/*', rawCors)
  }

  if (backend) {
    return base.route('/stats', statsRoutes).route(
      '/connections',
      createBackendConnectionRoutes(backend, {
        trustedOrigins: options.trustedOrigins,
        rootApiKey: backendRootApiKey,
      }),
    )
  }

  if (database && resolveProviders) {
    return createSelfHostedApiRoutes(base, resolveProviders, database, options)
  }

  return base.route('/stats', statsRoutes)
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
  const api = createApiRoutes(
    unavailableProviders,
    unavailableDatabase,
    undefined,
    {},
  )
  const response = await api.request('/openapi.json')
  if (!response.ok) {
    throw new Error(`Failed to create Hookfish OpenAPI: ${response.status}`)
  }
  return response.json()
}

/** Stable Hono RPC contract; managed backends implement the same connection API. */
export type AppType = ReturnType<typeof createSelfHostedApiRoutes>

export type HookfishRuntime<Bindings extends object = object> = {
  /** Label shown by `/api/client/health`. @default "fetch" */
  runtime?: HookfishBackendOptions<Bindings>['runtime']
  /** Override application origins for a runtime-specific deployment. */
  clientOrigins?: HookfishBackendOptions<Bindings>['clientOrigins']
  /** Override the root key used to sign ephemeral application capabilities. */
  rootApiKey?: HookfishBackendOptions<Bindings>['rootApiKey']
}

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
  readonly db: DatabaseInput<Bindings> | undefined
  readonly backend: HookfishBackend<Bindings> | undefined
  readonly includeSwagger: boolean
  readonly returnTo: string | undefined
  private readonly resolveProviders:
    | ((bindings: Bindings) => Promise<BoundProviderSource>)
    | undefined
  private constructor(
    options: HookfishConfig<Bindings>,
    runtime: HookfishRuntime<Bindings>,
    resolveProviders:
      | ((bindings: Bindings) => Promise<BoundProviderSource>)
      | undefined,
  ) {
    super()
    this.resolveProviders = resolveProviders
    this.db = options.db
    this.backend = options.backend
    this.includeSwagger = options.includeSwagger ?? true
    this.returnTo = options.returnTo
    const api = createApiRoutes(
      resolveProviders,
      this.db,
      this.backend,
      options,
      this.includeSwagger,
      runtime.rootApiKey,
    )
    const rawApp = new OpenAPIHono<BrokerContext<Bindings>>().route('/api', api)
    const backend = createHookfishBackend({
      config: options,
      hookfishFetch: (request, bindings, executionContext) =>
        rawApp.fetch(request, bindings ?? {}, executionContext),
      runtime: runtime.runtime,
      clientOrigins: runtime.clientOrigins,
      rootApiKey:
        runtime.rootApiKey ??
        ((bindings) =>
          requireBrokerApiKey(resolveBrokerConfig(bindings ?? {}))),
      supportsStaticSecrets: !this.backend,
    })

    const handleRequest = (context: {
      readonly env: Bindings
      readonly executionCtx: ExecutionContext
      readonly req: { readonly raw: Request }
    }) =>
      backend.fetch(
        context.req.raw,
        context.env,
        optionalExecutionContext(context),
      )

    this.all('/api', handleRequest)
    this.all('/api/*', handleRequest)
  }

  static async init<Bindings extends object = object>(
    options: HookfishConfig<Bindings>,
    runtime: HookfishRuntime<Bindings> = {},
  ): Promise<HookfishServer<Bindings>> {
    validateHookfishOptions(options)
    const resolveProviders = options.backend
      ? undefined
      : createProviderResolver(options.providers)
    return new HookfishServer<Bindings>(options, runtime, resolveProviders)
  }

  /** Resolve one provider without listing a lazy source. */
  readonly getProvider = async (
    providerId: string,
    bindings: Bindings,
  ): Promise<ConnectionProvider | undefined> => {
    const providers = await this.resolveProviders?.(bindings)
    return providers?.getProvider(providerId)
  }

  /** Materialize the configured provider listing as an in-memory registry. */
  readonly getProviders = async (
    bindings: Bindings,
  ): Promise<ProviderRegistry> => {
    const providers = await this.resolveProviders?.(bindings)
    if (!providers) {
      throw new Error(
        'Managed backends expose provider metadata through the connections API.',
      )
    }
    return materializeProviderRegistry(providers)
  }

  readonly migrate = (bindings: Bindings): Promise<void> => {
    return this.db ? migrateDatabase(this.db, bindings) : Promise.resolve()
  }
}

/** Create a Hookfish server with an optional application auth provider. */
export function createHookfish<Bindings extends object = object>(
  options: HookfishConfig<Bindings>,
  runtime: HookfishRuntime<Bindings> = {},
): Promise<HookfishServer<Bindings>> {
  return HookfishServer.init(options, runtime)
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
export type {
  ApplicationAuthProvider,
  ApplicationAuthResult,
  ApplicationPrincipal,
} from './application-auth.js'
export {
  HookfishBackend,
  type HookfishBackendAccessResult,
  type HookfishBackendAdapter,
  type HookfishBackendAuthorizationRequired,
  type HookfishBackendConnection,
  type HookfishBackendConnectionInput,
  type HookfishBackendContext,
  type HookfishBackendDisconnectResult,
  type HookfishBackendProvider,
} from './backend.js'
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
