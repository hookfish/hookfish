import { randomBytes } from 'node:crypto'
import { createHookfishClient } from '@hookfish/client'
import handler, { createServerEntry } from '@tanstack/react-start/server-entry'

const sessionToken = randomBytes(32).toString('base64url')

function getClient(request: Request) {
  return createHookfishClient({
    apiUrl:
      process.env.HOOKFISH_BACKEND_URL ??
      `http://127.0.0.1:${process.env.HOOKFISH_BACKEND_PORT ?? '8787'}`,
    apiKey: () => process.env.HOOKFISH_API_KEY?.trim(),
    frontendOrigin:
      process.env.HOOKFISH_FRONTEND_URL ?? new URL(request.url).origin,
    sessionToken,
    fallback: (fallbackRequest) => handler.fetch(fallbackRequest),
  })
}

export default createServerEntry({
  fetch: (request) => getClient(request).fetch(request),
})
