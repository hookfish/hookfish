import { Hookfish } from '@hookfish/api'
import { HookfishDurableObject } from '@hookfish/database/durable-object'
import config from '../hookfish.config'

export { HookfishDurableObject }

const hookfish = await Hookfish.init<Env>(config)

export default {
  fetch(request, env, ctx) {
    return hookfish.fetch(request, env, ctx)
  },
} satisfies ExportedHandler<Env>
