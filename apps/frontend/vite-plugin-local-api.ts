import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { register } from 'tsx/esm/api'
import type { Connect, Plugin } from 'vite'

const frontendRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(frontendRoot, '../..')
const frontendEnvPath = path.join(frontendRoot, '.env')
const serverEnvPath = path.join(repoRoot, 'apps/server/.env')
const defaultDataDir = path.join(repoRoot, 'apps/server/pgdata')

function isApiPath(url: string | undefined): boolean {
  const pathname = (url ?? '').split('?')[0] ?? ''
  return pathname === '/api' || pathname.startsWith('/api/')
}

type ApiFetch = (
  request: Request,
  env?: unknown,
  ctx?: unknown,
) => Response | Promise<Response>

type RequestListener = (
  incoming: IncomingMessage,
  outgoing: ServerResponse,
) => Promise<void>

function readApiFetch(module: unknown): ApiFetch {
  if (typeof module !== 'object' || module === null || !('default' in module)) {
    throw new Error('Invalid @template/api module shape')
  }

  const app = Reflect.get(module, 'default')
  if (typeof app !== 'object' || app === null || !('fetch' in app)) {
    throw new Error('Invalid @template/api default export')
  }

  const fetchFn = Reflect.get(app, 'fetch')
  if (typeof fetchFn !== 'function') {
    throw new Error('Invalid @template/api fetch handler')
  }

  return (request, env, ctx) => {
    const result: unknown = Reflect.apply(fetchFn, app, [request, env, ctx])
    if (result instanceof Response || result instanceof Promise) {
      return result
    }
    throw new Error('API fetch must return a Response')
  }
}

async function createBrokerEnv(
  module: unknown,
  dataDir: string,
): Promise<Record<string, unknown>> {
  if (
    typeof module !== 'object' ||
    module === null ||
    !('createLocalBrokerEnv' in module)
  ) {
    throw new Error('Invalid @template/api/local-node module shape')
  }

  const createLocalBrokerEnv = Reflect.get(module, 'createLocalBrokerEnv')
  if (typeof createLocalBrokerEnv !== 'function') {
    throw new Error('Invalid createLocalBrokerEnv export')
  }

  const result: unknown = await Reflect.apply(createLocalBrokerEnv, undefined, [
    dataDir,
  ])
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    throw new Error('createLocalBrokerEnv must resolve to an object')
  }

  const env: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(result)) {
    env[key] = value
  }
  return env
}

function readRequestListener(
  module: unknown,
  fetchCallback: (request: Request) => unknown,
): RequestListener {
  if (
    typeof module !== 'object' ||
    module === null ||
    !('getRequestListener' in module)
  ) {
    throw new Error('Invalid @hono/node-server module shape')
  }

  const getRequestListener = Reflect.get(module, 'getRequestListener')
  if (typeof getRequestListener !== 'function') {
    throw new Error('Invalid getRequestListener export')
  }

  const listener: unknown = Reflect.apply(getRequestListener, undefined, [
    fetchCallback,
  ])
  if (typeof listener !== 'function') {
    throw new Error('getRequestListener must return a function')
  }

  return async (incoming, outgoing) => {
    const result: unknown = Reflect.apply(listener, undefined, [
      incoming,
      outgoing,
    ])
    if (result instanceof Promise) {
      await result
    }
  }
}

/**
 * Serves `@template/api` from Node during `vite`/`pnpm dev`, before requests
 * reach Cloudflare workerd. Uses PGlite when DATABASE_URL is unset, or stock
 * Postgres when it is set. Production Workers use Hyperdrive or DATABASE_URL.
 */
export function localApiPlugin(): Plugin {
  return {
    name: 'local-pglite-api',
    configureServer(server) {
      const loadedEnvPaths: string[] = []
      for (const envPath of [frontendEnvPath, serverEnvPath]) {
        try {
          // The first value loaded wins, so frontend settings are authoritative
          // and the standalone server's file remains a convenient fallback.
          process.loadEnvFile(envPath)
          loadedEnvPaths.push(envPath)
        } catch {
          // A missing fallback file is fine as long as one env file exists.
        }
      }

      if (loadedEnvPaths.length > 0) {
        server.config.logger.info(
          `[api] loaded env from ${loadedEnvPaths.join(', ')}`,
        )
      } else {
        server.config.logger.warn(
          '[api] no frontend or server .env — using ambient env only.\n' +
            '  Create apps/frontend/.env or apps/server/.env from apps/server/.env.example.',
        )
      }

      const dataDir = process.env.PGLITE_DATA_DIR ?? defaultDataDir
      let listener: RequestListener | undefined
      let setupError: unknown
      let unregister: (() => Promise<void>) | undefined

      const ready = (async () => {
        unregister = register()

        // Non-literal specifiers keep `tsc` from typechecking the API package
        // under this Node-only Vite config.
        const apiSpecifier: string = '@template/api'
        const localNodeSpecifier: string = '@template/api/local-node'
        const nodeServerSpecifier: string = '@hono/node-server'

        const [apiModule, localNodeModule, nodeServerModule] =
          await Promise.all([
            import(apiSpecifier),
            import(localNodeSpecifier),
            import(nodeServerSpecifier),
          ])

        const appFetch = readApiFetch(apiModule)
        const env = await createBrokerEnv(localNodeModule, dataDir)
        listener = readRequestListener(nodeServerModule, (request) =>
          appFetch(request, env),
        )
        server.config.logger.info(`[api] PGlite mounted at /api (${dataDir})`)
      })().catch((error: unknown) => {
        setupError = error
        server.config.logger.error(
          `[api] failed to start PGlite: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      })

      const cleanup = () => {
        void unregister?.()
      }
      server.httpServer?.once('close', cleanup)

      return () => {
        const middleware: Connect.NextHandleFunction = (req, res, next) => {
          if (!isApiPath(req.url)) {
            next()
            return
          }

          void ready.then(() => {
            if (setupError || !listener) {
              res.statusCode = 500
              res.setHeader('content-type', 'text/plain; charset=utf-8')
              res.end(
                setupError instanceof Error
                  ? setupError.message
                  : 'Local PGlite API failed to start',
              )
              return
            }

            return listener(req, res)
          })
        }

        server.middlewares.use(middleware)
        // Cloudflare's plugin dispatches to workerd early; keep this first.
        const stack = server.middlewares.stack
        const entry = stack.pop()
        if (entry) {
          stack.unshift(entry)
        }
      }
    },
  }
}
