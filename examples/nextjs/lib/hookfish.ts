import path from 'node:path'

async function initializeHookfish() {
  const [{ Hookfish }, { pglite }, { default: config }] = await Promise.all([
    import('@hookfish/api'),
    import('@hookfish/database/pglite'),
    import('../../../hookfish.config'),
  ])
  const db = pglite(process.env.PGLITE_DATA_DIR ?? '../../pgdata')
  return Hookfish.init(config, { db, runtime: 'nextjs' })
}

let hookfishPromise: ReturnType<typeof initializeHookfish> | undefined

export async function handleHookfish(request: Request): Promise<Response> {
  process.env.PGLITE_DATA_DIR ??= path.resolve(process.cwd(), '../../pgdata')
  hookfishPromise ??= initializeHookfish()
  const hookfish = await hookfishPromise
  return hookfish.fetch(request, process.env)
}
