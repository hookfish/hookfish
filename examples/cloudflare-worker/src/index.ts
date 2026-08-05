import { Hookfish } from '@hookfish/api'
import { postgres } from '@hookfish/database/postgres'
import config from '../../../hookfish.config'

const db = postgres<Env>((bindings) => bindings.HYPERDRIVE.connectionString, {
  cache: false,
  fetchTypes: false,
  max: 5,
  prepare: true,
})
const hookfish = await Hookfish.init<Env>(config, {
  db,
  runtime: 'cloudflare-worker',
})

export default {
  fetch(request, env, ctx) {
    return hookfish.fetch(request, env, ctx)
  },
} satisfies ExportedHandler<Env>
