import { swaggerUI } from '@hono/swagger-ui'
import { OpenAPIHono } from '@hono/zod-openapi'
import {
  type ConnectionProvider,
  type ProviderRegistry,
} from '@hookfish/provider'
import { Hono, type ExecutionContext } from 'hono'
import { cors } from 'hono/cors'

import {
  type BrowserRequestAuthorizer,
  createHookfishBackend,
  type HookfishBackendOptions,
  isAllowedClientRequest,
} from './client.js'
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
  /** Mount the browser-safe, credential-injecting facade at `/api/client`. @default false */
  includeClient?: boolean
  /** Include server-only operations in OpenAPI. Client operations are always documented. @default true */
  includeSwagger?: boolean
  /** Fixed destination after a successful OAuth callback. Omit for the development completion page. */
  returnTo?: string
  /** Origins allowed by the per-authorization `return_to` option. */
  trustedOrigins?: readonly string[]
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

function validateHookfishOptions(
  options: Pick<HookfishConfig, 'returnTo' | 'trustedOrigins'>,
): void {
  if (options.returnTo) validateHttpUrl('returnTo', options.returnTo)
  for (const origin of options.trustedOrigins ?? []) {
    validateHttpUrl('Each trustedOrigins entry', origin)
  }
}

function createApiRoutes<Bindings extends object>(
  resolveProviders: (bindings: Bindings) => Promise<BoundProviderSource>,
  database: DatabaseInput<Bindings>,
  options: Pick<
    HookfishConfig<Bindings>,
    'returnTo' | 'trustedOrigins' | 'onEvent'
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

  base.get('/openapi.json', (context) => {
    const document = base.getOpenAPI31Document({
      openapi: '3.1.0',
      info: {
        title: 'Hookfish API',
        version: '0.0.0',
      },
      servers: [{ url: includeSwagger ? '/api' : '/api/client' }],
    })

    if (!includeSwagger) {
      const operationMethods = [
        'get',
        'put',
        'post',
        'delete',
        'options',
        'head',
        'patch',
        'trace',
      ] as const

      for (const [pathname, pathItem] of Object.entries(document.paths ?? {})) {
        const apiPath = pathname.startsWith('/api')
          ? pathname
          : `/api${pathname}`
        for (const method of operationMethods) {
          if (!isAllowedClientRequest(method, apiPath)) {
            delete pathItem[method]
          }
        }
        if (!operationMethods.some((method) => pathItem[method])) {
          delete document.paths?.[pathname]
        }
      }
    }

    return context.json(document)
  })

  base.get('/docs', swaggerUI({ url: '/api/openapi.json' }))

  const api = base
    .use('/stats', cors())
    .route('/stats', statsRoutes)
    .use('/admin/*', cors())
    .route('/admin', createAdminRoutes(database, options.onEvent))
    .use('/connections', cors())
    .use('/connections/*', cors())
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

export type HookfishRuntime<Bindings extends object = object> = {
  /** Label shown by `/api/client/health`. @default "fetch" */
  runtime?: HookfishBackendOptions<Bindings>['runtime']
  /** Override `trustedOrigins` with a runtime-specific browser allowlist. */
  browserOrigins?: HookfishBackendOptions<Bindings>['browserOrigins']
  /** Override the root credential injected by the browser facade. */
  brokerApiKey?: HookfishBackendOptions<Bindings>['brokerApiKey']
  /** Apply application/session authorization before serving browser routes. */
  authorizeBrowserRequest?: BrowserRequestAuthorizer<Bindings>
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
  readonly db: DatabaseInput<Bindings>
  readonly includeClient: boolean
  readonly includeSwagger: boolean
  readonly returnTo: string | undefined
  private readonly resolveProviders: (
    bindings: Bindings,
  ) => Promise<BoundProviderSource>
  private constructor(
    options: HookfishConfig<Bindings>,
    runtime: HookfishRuntime<Bindings>,
    resolveProviders: (bindings: Bindings) => Promise<BoundProviderSource>,
  ) {
    super()
    this.resolveProviders = resolveProviders
    this.db = options.db
    this.includeClient = options.includeClient ?? false
    this.includeSwagger = options.includeSwagger ?? true
    this.returnTo = options.returnTo
    const api = createApiRoutes(
      resolveProviders,
      this.db,
      options,
      this.includeSwagger,
    )
    const rawApp = new OpenAPIHono<BrokerContext<Bindings>>().route('/api', api)
    const backend = createHookfishBackend({
      config: options,
      hookfishFetch: (request, bindings, executionContext) =>
        rawApp.fetch(request, bindings ?? {}, executionContext),
      runtime: runtime.runtime,
      browserOrigins: runtime.browserOrigins,
      brokerApiKey:
        runtime.brokerApiKey ??
        ((bindings) =>
          requireBrokerApiKey(resolveBrokerConfig(bindings ?? {}))),
      authorizeBrowserRequest: runtime.authorizeBrowserRequest,
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
    const resolveProviders = createProviderResolver(options.providers)
    return new HookfishServer<Bindings>(options, runtime, resolveProviders)
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
