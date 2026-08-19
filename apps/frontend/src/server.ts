import { randomBytes } from 'node:crypto'
import { createHookfishClient } from '@hookfish/client'
import handler, { createServerEntry } from '@tanstack/react-start/server-entry'

const sessionToken = randomBytes(32).toString('base64url')

const client = createHookfishClient({
  apiUrl:
    process.env.HOOKFISH_BACKEND_URL ??
    `http://127.0.0.1:${process.env.HOOKFISH_BACKEND_PORT ?? '8787'}`,
  apiKey: () => process.env.HOOKFISH_API_KEY?.trim(),
  frontendOrigin: (request) =>
    process.env.HOOKFISH_FRONTEND_URL ?? new URL(request.url).origin,
  sessionToken,
  fallback: (request) => handler.fetch(request),
})

export default createServerEntry({
  fetch: (request) => client.fetch(request),
})
