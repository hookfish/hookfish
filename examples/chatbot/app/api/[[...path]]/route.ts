import { hookfishServerPromise } from '@/lib/hookfish'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handle(request: Request) {
  const hookfish = await hookfishServerPromise
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
