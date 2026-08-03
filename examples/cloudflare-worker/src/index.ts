import { Hookfish } from '@hookfish/api'
import { postgres } from '@hookfish/database/postgres'
import {
  GitHubProvider,
  LinearProvider,
  NotionProvider,
} from '@hookfish/providers'

const hookfish = new Hookfish<Env>({
  db: postgres((bindings: Env) => bindings.HYPERDRIVE.connectionString, {
    cache: false,
    fetchTypes: false,
    max: 5,
    prepare: true,
  }),
  providers: {
    github: new GitHubProvider(),
    linear: new LinearProvider(),
    notion: new NotionProvider(),
  },
})

export default {
  fetch(request, env, ctx) {
    return hookfish.fetch(request, env, ctx)
  },
} satisfies ExportedHandler<Env>
