import { swaggerUI } from '@hono/swagger-ui'
import { OpenAPIHono } from '@hono/zod-openapi'
import { type OAuthProvider, type ProviderRegistry } from '@hookfish/provider'
import type { ExecutionContext } from 'hono'
import { cors } from 'hono/cors'

import {
  type BrowserRequestAuthorizer,
  createHookfishBackend,
  type HookfishBackendOptions,
  isAllowedClientRequest,
} from './client'
import { type DatabaseInput, migrateDatabase } from './db/binding'
import type { HookfishEventHandler } from './events'
import { requireBrokerApiKey, resolveBrokerConfig } from './oauth/config'
import type { BrokerContext } from './oauth/middleware'
import { ORGANIZATION_PATTERN } from './oauth/organization'
import {
  type BoundProviderSource,
  createProviderResolver,
  materializeProviderRegistry,
  type ProviderInput,
} from './provider-source'
import { createAdminRoutes } from './routes/admin'
import { createOAuthRoutes } from './routes/oauth'
import { createProviderRoutes } from './routes/providers'
import { createSecretRoutes } from './routes/secrets'
import { statsRoutes } from './routes/stats'

export type { ProviderFactory, ProviderMap } from './provider-source'

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
  /** Prefix OAuth management routes with `/organization/:organization`. The provider callback remains global. @default false */
  organizationRouting?: boolean
  /** Expose root-authenticated CRUD for database-backed provider instances. @default false */
  providerManagement?: boolean
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
    | 'returnTo'
    | 'trustedOrigins'
    | 'organizationRouting'
    | 'providerManagement'
    | 'onEvent'
  >,
  includeSwagger = true,
  includeAllOpenApiRoutes = false,
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

    for (const [pathname, pathItem] of Object.entries(document.paths ?? {})) {
      if (!pathname.startsWith('/organization/{organization}/')) continue
      for (const operation of Object.values(pathItem)) {
        if (
          operation &&
          typeof operation === 'object' &&
          'operationId' in operation &&
          typeof operation.operationId === 'string'
        ) {
          operation.operationId = `organization.${operation.operationId}`
        }
      }
    }

    // Organization mode still mounts the global OAuth app for the provider
    // callback. Keep its inactive management operations (and the inverse
    // organization callback) out of the generated document.
    if (options.organizationRouting) {
      for (const [pathname, pathItem] of Object.entries(document.paths ?? {})) {
        const isGlobalManagementRoute =
          pathname.startsWith('/oauth/') &&
          pathname !== '/oauth/callback/{provider_path}' &&
          pathname !== '/oauth/client-metadata/{provider_path}'
        const isOrganizationCallback =
          pathname ===
          '/organization/{organization}/oauth/callback/{provider_path}'
        const isOrganizationClientMetadata =
          pathname ===
          '/organization/{organization}/oauth/client-metadata/{provider_path}'

        if (
          isOrganizationCallback ||
          isOrganizationClientMetadata ||
          (!includeAllOpenApiRoutes && isGlobalManagementRoute)
        ) {
          delete document.paths?.[pathname]
          continue
        }

        if (pathname.startsWith('/organization/{organization}/')) {
          pathItem.parameters = [
            ...(pathItem.parameters ?? []),
            {
              name: 'organization',
              in: 'path',
              required: true,
              description: pathname.includes('/oauth/')
                ? 'Organization namespace for OAuth connections.'
                : 'Organization namespace for Hookfish resources.',
              schema: {
                type: 'string',
                pattern: ORGANIZATION_PATTERN.source,
                minLength: 1,
                maxLength: 128,
              },
            },
          ]
        }
      }
    }

    if (!options.providerManagement && !includeAllOpenApiRoutes) {
      for (const pathname of Object.keys(document.paths ?? {})) {
        if (
          pathname.startsWith('/admin/providers') ||
          pathname.includes('/admin/providers')
        ) {
          delete document.paths?.[pathname]
        }
      }
    }

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
    .route(
      '/admin',
      createProviderRoutes(resolveProviders, database, {
        ...options,
        enabled: options.providerManagement ?? false,
        routeMode: 'global',
      }),
    )
    .use('/oauth/*', cors())
    .route(
      '/oauth',
      createOAuthRoutes(resolveProviders, database, {
        ...options,
        routeMode: 'global',
      }),
    )
    .use('/secrets', cors())
    .use('/secrets/*', cors())
    .route(
      '/',
      createSecretRoutes(database, {
        ...options,
        routeMode: 'global',
      }),
    )

  if (options.organizationRouting) {
    api.use('/organization/:organization/oauth/*', cors()).route(
      '/organization/:organization/oauth',
      createOAuthRoutes(resolveProviders, database, {
        ...options,
        routeMode: 'organization',
      }),
    )
    api
      .use('/organization/:organization/secrets', cors())
      .use('/organization/:organization/secrets/*', cors())
      .route(
        '/organization/:organization',
        createSecretRoutes(database, {
          ...options,
          routeMode: 'organization',
        }),
      )

    if (options.providerManagement) {
      api
        .use('/organization/:organization/admin/providers', cors())
        .use('/organization/:organization/admin/providers/*', cors())
        .route(
          '/organization/:organization/admin',
          createProviderRoutes(resolveProviders, database, {
            ...options,
            enabled: true,
            routeMode: 'organization',
          }),
        )
    }
  }

  return api
}

/**
 * Build the complete server contract used to generate the first-party SDK.
 * Unlike a deployment's `/api/openapi.json`, this includes both global and
 * organization-prefixed operations plus optional provider management routes.
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
    {
      organizationRouting: true,
      providerManagement: true,
    },
    true,
    true,
  )
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

/**
 * A self-contained Hookfish request handler.
 *
 * `fetch` is an instance property so it can be passed directly to Node,
 * Cloudflare Workers, or another Fetch-compatible host without rebinding it.
 */
export class HookfishServer<Bindings extends object = object> {
  readonly db: DatabaseInput<Bindings>
  readonly includeClient: boolean
  readonly includeSwagger: boolean
  readonly providerManagement: boolean
  readonly returnTo: string | undefined
  private readonly resolveProviders: (
    bindings: Bindings,
  ) => Promise<BoundProviderSource>
  private readonly app: {
    fetch(
      request: Request,
      bindings?: Bindings | object,
      executionContext?: ExecutionContext,
    ): Response | Promise<Response>
  }

  private constructor(
    options: HookfishConfig<Bindings>,
    runtime: HookfishRuntime<Bindings>,
    resolveProviders: (bindings: Bindings) => Promise<BoundProviderSource>,
  ) {
    this.resolveProviders = resolveProviders
    this.db = options.db
    this.includeClient = options.includeClient ?? false
    this.includeSwagger = options.includeSwagger ?? true
    this.providerManagement = options.providerManagement ?? false
    this.returnTo = options.returnTo
    const api = createApiRoutes(
      resolveProviders,
      this.db,
      options,
      this.includeSwagger,
    )
    const rawApp = new OpenAPIHono<BrokerContext<Bindings>>().route('/api', api)
    this.app = createHookfishBackend({
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
  }

  static async init<Bindings extends object = object>(
    options: HookfishConfig<Bindings>,
    runtime: HookfishRuntime<Bindings> = {},
  ): Promise<HookfishServer<Bindings>> {
    validateHookfishOptions(options)
    const resolveProviders = createProviderResolver(options.providers)
    return new HookfishServer(options, runtime, resolveProviders)
  }

  readonly fetch = (
    request: Request,
    bindings: Bindings | undefined = undefined,
    executionContext?: ExecutionContext,
  ): Response | Promise<Response> => {
    return this.app.fetch(request, bindings ?? {}, executionContext)
  }

  /** Resolve one provider without listing a lazy source. */
  readonly getProvider = async (
    providerId: string,
    bindings: Bindings,
  ): Promise<OAuthProvider | undefined> => {
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
  type DatabaseContext,
  type DatabaseInput,
  defineDatabase,
  migrateDatabase,
} from './db/binding'
export type {
  BrokerAccessToken,
  Database,
  DatabaseResult,
  NewBrokerAccessToken,
  NewOAuthConnection,
  NewOAuthProviderRecord,
  NewOAuthState,
  NewVaultSecret,
  OAuthConnection,
  OAuthConnectionFilter,
  OAuthConnectionSummary,
  OAuthConnectionTokenUpdate,
  OAuthProviderRecord,
  OAuthProviderUpdate,
  OAuthState,
  OAuthStateUpdate,
  VaultSecret,
  VaultSecretFilter,
  VaultSecretMetadata,
} from './db/types'
export type { HookfishEvent, HookfishEventHandler } from './events'
