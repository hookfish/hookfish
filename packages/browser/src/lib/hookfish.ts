import { createHookfishHooks } from '@hookfish/hooks'

const clients = new Map<string, ReturnType<typeof createHookfishHooks>>()

export function hookfishFor(baseUrl: string) {
  const existing = clients.get(baseUrl)
  if (existing) return existing
  const client = createHookfishHooks({ baseUrl })
  clients.set(baseUrl, client)
  return client
}
