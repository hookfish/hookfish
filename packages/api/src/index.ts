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
import { createAdminRoutes } from './routes/admin'
import { createOAuthRoutes } from './routes/oauth'
import { createProviderRoutes } from './routes/providers'
import { createSecretRoutes } from './routes/secrets'
import { statsRoutes } from './routes/stats'

export type ProviderMap = Record<string, OAuthProvider>

export type ProviderFactory<Bindings extends object> = (
  bindings: Bindings,
) => ProviderMap | Promise<ProviderMap>

export type HookfishProviders<Bindings extends object = object> =
  | ProviderMap
  | ProviderRegistry
  | ProviderFactory<Bindings>

export type HookfishConfig<Bindings extends object = object> = {
  /** Fixed providers or a request-aware factory resolved from runtime bindings. */
  providers: HookfishProviders<Bindings>
  /** Default database binding. A runtime host may override it in `Hookfish.init`. */
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

function normalizeProviders(providers: ProviderMap | ProviderRegistry) {
  return isProviderRegistry(providers)
    ? providers
    : createProviderRegistry(providers)
}

async function resolveProviderSource<Bindings extends object>(
  source: HookfishProviders<Bindings>,
  bindings: Bindings,
): Promise<ProviderRegistry> {
  const providers =
    typeof source === 'function' ? await source(bindings) : source
  return normalizeProviders(providers)
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
  resolveProviders: (bindings: Bindings) => Promise<ProviderRegistry>,
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
) {
  const base = new OpenAPIHono<BrokerContext<Bindings>>()

  base.openAPIRegistry.registerComponent('securitySchemes', 'brokerApiKey', {
    type: 'http',
    scheme: 'bearer',
    description:
      'Send BROKER_API_KEY for root access, or a named scoped token minted by POST /admin/tokens.',
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
          isGlobalManagementRoute ||
          isOrganizationCallback ||
          isOrganizationClientMetadata
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

    if (!options.providerManagement) {
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

  base.get('/', swaggerUI({ url: '/api/openapi.json' }))

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
export class Hookfish<Bindings extends object = object> {
  readonly db: DatabaseInput<Bindings>
  readonly includeClient: boolean
  readonly includeSwagger: boolean
  readonly providerManagement: boolean
  readonly returnTo: string | undefined
  private readonly resolveProviders: (
    bindings: Bindings,
  ) => Promise<ProviderRegistry>
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
    resolveProviders: (bindings: Bindings) => Promise<ProviderRegistry>,
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
  ): Promise<Hookfish<Bindings>> {
    validateHookfishOptions(options)
    const staticProviders =
      typeof options.providers === 'function'
        ? undefined
        : normalizeProviders(options.providers)
    const resolveProviders = staticProviders
      ? async () => staticProviders
      : (bindings: Bindings) =>
          resolveProviderSource(options.providers, bindings)
    return new Hookfish(options, runtime, resolveProviders)
  }

  readonly fetch = (
    request: Request,
    bindings: Bindings | undefined = undefined,
    executionContext?: ExecutionContext,
  ): Response | Promise<Response> => {
    return this.app.fetch(request, bindings ?? {}, executionContext)
  }

  /** Resolve the provider registry for one runtime binding set. */
  readonly getProviders = (bindings: Bindings): Promise<ProviderRegistry> => {
    return this.resolveProviders(bindings)
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
    typeof Reflect.get(value, 'getProviders') === 'function'
  )
}

export { z } from 'zod'
export type { HookfishEvent, HookfishEventHandler } from './events'
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
  OAuthConnection,
  OAuthProviderRecord,
  OAuthState,
  VaultSecret,
} from './db/schema'
