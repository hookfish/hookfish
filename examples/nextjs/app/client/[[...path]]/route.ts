import { handleBackend } from '../../../lib/backend'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export {
  handleBackend as DELETE,
  handleBackend as GET,
  handleBackend as HEAD,
  handleBackend as OPTIONS,
  handleBackend as PATCH,
  handleBackend as POST,
  handleBackend as PUT,
}
