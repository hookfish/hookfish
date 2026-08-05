import { type DatabaseInput, defineHookfishConfig, z } from '@hookfish/api'
import {
  GitHubProvider,
  LinearProvider,
  NotionProvider,
} from '@hookfish/providers'

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

export type CreateHookfishConfigOptions<Bindings extends object> = {
  db: DatabaseInput<Bindings>
  frontendUrl?: string
}

/** Shared providers and browser policy; each host supplies its own database. */
export function createHookfishConfig<Bindings extends object = object>({
  db,
  frontendUrl = process.env.HOOKFISH_FRONTEND_URL ?? 'http://127.0.0.1:5173',
}: CreateHookfishConfigOptions<Bindings>) {
  return defineHookfishConfig({
    config: configSchema,
    db,
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
}
