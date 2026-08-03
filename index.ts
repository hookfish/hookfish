import { registerProvider } from '@template/provider'
import {
  GitHubProvider,
  LinearProvider,
  NotionProvider,
} from '@template/providers'

export const providers = registerProvider({
  github: new GitHubProvider(),
  linear: new LinearProvider(),
  notion: new NotionProvider(),
})
