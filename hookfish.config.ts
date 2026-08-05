import { defineHookfishConfig, z } from '@hookfish/api'
import {
  GitHubProvider,
  LinearProvider,
  NotionProvider,
} from '@hookfish/providers'

const frontendUrl = process.env.HOOKFISH_FRONTEND_URL ?? 'http://127.0.0.1:5173'

const configSchema = z.object({
  GITHUB_CLIENT_ID: z
    .string()
    .optional()
    .prefault(process.env.GITHUB_CLIENT_ID!),
  GITHUB_CLIENT_SECRET: z
    .string()
    .optional()
    .prefault(process.env.GITHUB_CLIENT_SECRET!),
})

export default defineHookfishConfig({
  config: configSchema,
  includeClient: true,
  includeSwagger: true,
  returnTo: frontendUrl,
  trustedOrigins: [frontendUrl],
  providers: (config) => ({
    github: new GitHubProvider({
      clientId: config.GITHUB_CLIENT_ID,
      clientSecret: config.GITHUB_CLIENT_SECRET,
    }),
    linear: new LinearProvider(),
    notion: new NotionProvider(),
  }),
})
