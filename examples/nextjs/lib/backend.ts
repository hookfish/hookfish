import path from 'node:path'
import type { HookfishBackend } from '@hookfish/backend'

let backendPromise: Promise<HookfishBackend<NodeJS.ProcessEnv>> | undefined

export async function handleBackend(request: Request): Promise<Response> {
  process.env.PGLITE_DATA_DIR ??= path.resolve(process.cwd(), '../../pgdata')
  backendPromise ??= Promise.all([
    import('@hookfish/api'),
    import('@hookfish/backend'),
    import('@hookfish/database/pglite'),
    import('../../../hookfish.config'),
  ]).then(
    async ([
      { Hookfish },
      { createHookfishBackend },
      { pglite },
      { default: config },
    ]) => {
      const db = pglite(process.env.PGLITE_DATA_DIR ?? '../../pgdata')
      const hookfish = await Hookfish.init(config, { db })
      return createHookfishBackend<NodeJS.ProcessEnv>({
        config,
        hookfishFetch: hookfish.fetch,
        runtime: 'nextjs',
      })
    },
  )
  const backend = await backendPromise
  return backend.fetch(request, process.env)
}
