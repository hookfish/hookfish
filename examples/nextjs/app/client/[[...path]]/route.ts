import { handleHookfish } from '../../../lib/hookfish'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export {
  handleHookfish as DELETE,
  handleHookfish as GET,
  handleHookfish as HEAD,
  handleHookfish as OPTIONS,
  handleHookfish as PATCH,
  handleHookfish as POST,
  handleHookfish as PUT,
}
