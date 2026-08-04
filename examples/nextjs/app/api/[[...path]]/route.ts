import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const handle = async (request: Request) => {
  process.env.PGLITE_DATA_DIR ??= path.resolve(process.cwd(), '../../pgdata')
  const { default: hookfish } = await import('../../../../../hookfish.config')

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
