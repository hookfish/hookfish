import { Hookfish } from '@hookfish/api'
import {
  durableObjects,
  HookfishDurableObject,
} from '@hookfish/database/durable-object'
import config from '../../../hookfish.config'

export { HookfishDurableObject }

const db = durableObjects<Env>((bindings, context) =>
  bindings.HOOKFISH_DB.getByName(context.organization ?? '__global__'),
)
const hookfish = await Hookfish.init<Env>({
  ...config,
  db,
})

export default {
  fetch(request, env, ctx) {
    return hookfish.fetch(request, env, ctx)
  },
} satisfies ExportedHandler<Env>
