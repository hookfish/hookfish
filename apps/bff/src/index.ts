import { serve } from '@hono/node-server'
import { betterAuth as applicationAuth } from '@hookfish/auth-better-auth'
import path from 'node:path'
import { createHookfishBff } from './app.ts'
import { createApplicationAuth } from './auth.ts'

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required by the Hookfish BFF.`)
  return value
}

const port = Number(process.env.BFF_PORT ?? 8788)
const hostname = process.env.BFF_HOST ?? '127.0.0.1'
const frontendOrigin =
  process.env.HOOKFISH_FRONTEND_URL ?? 'http://127.0.0.1:5173'
const publicOrigin = process.env.BETTER_AUTH_URL ?? `http://${hostname}:${port}`
const backendOrigin = new URL(
  process.env.HOOKFISH_BACKEND_URL ?? 'http://127.0.0.1:8787',
)
const rootApiKey = requiredEnvironment('HOOKFISH_API_KEY')
const auth = await createApplicationAuth({
  baseUrl: publicOrigin,
  databasePath: path.resolve(
    process.env.BETTER_AUTH_DATABASE_PATH ?? '.data/better-auth.sqlite',
  ),
  secret: requiredEnvironment('BETTER_AUTH_SECRET'),
  trustedOrigins: [frontendOrigin],
})

const app = createHookfishBff<NodeJS.ProcessEnv>({
  applicationAuth: applicationAuth(auth),
  authHandler: (request) => auth.handler(request),
  clientOrigins: [frontendOrigin],
  hookfishFetch: async (request) => {
    const source = new URL(request.url)
    const target = new URL(`${source.pathname}${source.search}`, backendOrigin)
    try {
      return await fetch(new Request(target, request))
    } catch {
      return Response.json(
        {
          error: {
            code: 'hookfish_backend_unavailable',
            message: 'The Hookfish backend is unavailable.',
          },
        },
        { status: 502 },
      )
    }
  },
  rootApiKey,
})

serve(
  {
    fetch: (request) => app.fetch(request, process.env),
    hostname,
    port,
  },
  (info) => {
    console.log(`Hookfish BFF on http://${hostname}:${info.port}`)
  },
)
