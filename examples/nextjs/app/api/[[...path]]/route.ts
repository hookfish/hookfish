import path from 'node:path'
import type { Hookfish } from '@hookfish/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

let hookfishPromise: Promise<Hookfish> | undefined

const handle = async (request: Request) => {
  process.env.PGLITE_DATA_DIR ??= path.resolve(process.cwd(), '../../pgdata')
  hookfishPromise ??= Promise.all([
    import('@hookfish/api'),
    import('../../../../../hookfish.config'),
  ]).then(([{ Hookfish }, { default: config }]) => Hookfish.init(config))
  const hookfish = await hookfishPromise

  return hookfish.fetch(request)
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
