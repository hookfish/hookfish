import path from 'node:path'
import type { HookfishBackend } from '@hookfish/backend'

let backendPromise: Promise<HookfishBackend<NodeJS.ProcessEnv>> | undefined

export async function handleBackend(request: Request): Promise<Response> {
  process.env.PGLITE_DATA_DIR ??= path.resolve(process.cwd(), '../../pgdata')
  backendPromise ??= Promise.all([
    import('@hookfish/api'),
    import('@hookfish/backend'),
    import('../../../hookfish.config'),
  ]).then(
    async ([{ Hookfish }, { createHookfishBackend }, { default: config }]) => {
      const hookfish = await Hookfish.init(config)
      return createHookfishBackend<NodeJS.ProcessEnv>({
        hookfishFetch: hookfish.fetch,
        browserOrigins: config.trustedOrigins,
        runtime: 'nextjs',
      })
    },
  )
  const backend = await backendPromise
  return backend.fetch(request, process.env)
}
