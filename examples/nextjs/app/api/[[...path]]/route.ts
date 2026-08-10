import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const initializeHookfish = () =>
  Promise.all([
    import('@hookfish/api'),
    import('../../../../../hookfish.config'),
  ]).then(([{ Hookfish }, { default: config }]) => Hookfish.init(config))

let hookfishPromise: ReturnType<typeof initializeHookfish> | undefined

const handle = async (request: Request) => {
  process.env.PGLITE_DATA_DIR ??= path.resolve(process.cwd(), '../../pgdata')
  hookfishPromise ??= initializeHookfish()
  const hookfish = await hookfishPromise

  return hookfish.fetch(request, process.env)
}

export {
  handle as DELETE,
  handle as GET,
  handle as HEAD,
  handle as OPTIONS,
  handle as PATCH,
  handle as POST,
  handle as PUT,
}
