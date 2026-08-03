import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { serve } from '@hono/node-server'
import { createApi } from '@template/api'
import { createLocalBrokerEnv } from '@template/api/local-node'
import { defaultProviderRegistry, isProviderRegistry } from '@template/provider'

export type ServeBrokerOptions = {
  entry: string
  projectRoot?: string
}

export type LoadedProviderConfig = {
  entryPath: string
  module: object
}

function loadProjectEnv(projectRoot: string): void {
  const candidates = [
    path.join(projectRoot, '.env'),
    path.join(projectRoot, 'apps/server/.env'),
  ]
  const envPath = candidates.find((candidate) => existsSync(candidate))

  if (!envPath) return

  process.loadEnvFile(envPath)
  console.log(`Loaded env from ${envPath}`)
}

export async function loadProviderConfig(
  entry: string,
  projectRoot = process.cwd(),
): Promise<LoadedProviderConfig> {
  const entryPath = path.resolve(projectRoot, entry)

  if (!existsSync(entryPath)) {
    throw new Error(
      `Provider config not found at ${entryPath}. Create an index.ts that calls registerProvider({ ... }).`,
    )
  }

  const module = await import(pathToFileURL(entryPath).href)
  return { entryPath, module }
}

export async function serveBroker(options: ServeBrokerOptions) {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd())
  loadProjectEnv(projectRoot)
  const config = await loadProviderConfig(options.entry, projectRoot)

  const exportedProviders = Reflect.get(config.module, 'providers')
  const providers = isProviderRegistry(exportedProviders)
    ? exportedProviders
    : defaultProviderRegistry
  const providerIds = providers.listProviderIds()
  if (providerIds.length === 0) {
    throw new Error(
      `${config.entryPath} did not register any providers. Call registerProvider({ slug: provider }).`,
    )
  }

  const dataDir =
    process.env.PGLITE_DATA_DIR ?? path.join(projectRoot, 'pgdata')
  const port = Number(process.env.PORT ?? 8787)
  const hostname = process.env.HOST ?? '127.0.0.1'
  const env = await createLocalBrokerEnv(dataDir)
  const app = createApi({ providers })

  return serve(
    { fetch: (request: Request) => app.fetch(request, env), port, hostname },
    (info) => {
      const configured = providerIds.filter((id) =>
        providers.isProviderConfigured(id),
      )
      const publicOrigin =
        process.env.OAUTH_REDIRECT_BASE_URL ?? `http://localhost:${info.port}`

      console.log(`OAuth broker on ${publicOrigin}/api`)
      console.log(`Provider config: ${config.entryPath}`)
      console.log(
        process.env.DATABASE_URL?.trim()
          ? 'Database: Postgres via DATABASE_URL (stock Node)'
          : `Database: PGlite at ${dataDir}`,
      )
      console.log(
        configured.length > 0
          ? `Providers configured: ${configured.join(', ')}`
          : `Providers registered but not configured: ${providerIds.join(', ')}`,
      )
    },
  )
}
