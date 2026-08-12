import { Hookfish } from '@hookfish/api'
import config from '../../../hookfish.config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const hookfishPromise = Hookfish.init(config)

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
