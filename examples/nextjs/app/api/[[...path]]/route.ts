import path from 'node:path'
import { Hookfish } from '@hookfish/api'
import { pglite } from '@hookfish/database/pglite'
import config from '../../../../../hookfish.config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const db = pglite<typeof process.env>(
  process.env.PGLITE_DATA_DIR ?? path.resolve(process.cwd(), '../../pgdata'),
)
const hookfishPromise = Hookfish.init({ ...config, db })

const handle = async (request: Request) => {
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
