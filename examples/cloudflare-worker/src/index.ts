import { Hookfish } from '@hookfish/api'
import { createHookfishBackend } from '@hookfish/backend'
import { postgres } from '@hookfish/database/postgres'
import config from '../../../hookfish.config'

const db = postgres<Env>((bindings) => bindings.HYPERDRIVE.connectionString, {
  cache: false,
  fetchTypes: false,
  max: 5,
  prepare: true,
})
const hookfish = await Hookfish.init(config, { db })
const backend = createHookfishBackend<Env>({
  config,
  hookfishFetch: hookfish.fetch,
  runtime: 'cloudflare-worker',
})

export default {
  fetch(request, env, ctx) {
    return backend.fetch(request, env, ctx)
  },
} satisfies ExportedHandler<Env>
