import { Hookfish } from '@hookfish/api'
import config from '../../../hookfish.config'

const hookfish = await Hookfish.init(config)

export default {
  fetch(request, env, ctx) {
    return hookfish.fetch(request, env, ctx)
  },
} satisfies ExportedHandler<Env>
