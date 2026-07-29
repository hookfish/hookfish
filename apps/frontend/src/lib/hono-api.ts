import { hc } from 'hono/client'
import type { InferResponseType } from 'hono/client'
import type { AppType } from '@template/api'
import { apiBaseUrl } from './api-url'

const api = hc<AppType>(`${apiBaseUrl}/api`)

export type StatsResponse = InferResponseType<typeof api.stats.$get>

export async function getStats(): Promise<StatsResponse> {
  const response = await api.stats.$get()

  if (!response.ok) {
    throw new Error(await response.text())
  }

  return response.json()
}
