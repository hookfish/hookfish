import hookfish from '../../../hookfish.config'

export default {
  fetch(request, env, ctx) {
    return hookfish.fetch(request, env, ctx)
  },
} satisfies ExportedHandler<Env>
