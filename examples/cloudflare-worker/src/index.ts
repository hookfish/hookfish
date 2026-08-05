import { Hookfish } from '@hookfish/api'
import { createHookfishBackend } from '@hookfish/backend'
import config from '../hookfish.config'

const hookfish = await Hookfish.init(config)
const backend = createHookfishBackend<Env>({
  hookfishFetch: hookfish.fetch,
  browserOrigins: config.trustedOrigins,
  runtime: 'cloudflare-worker',
})

export default {
  fetch(request, env, ctx) {
    return backend.fetch(request, env, ctx)
  },
} satisfies ExportedHandler<Env>
