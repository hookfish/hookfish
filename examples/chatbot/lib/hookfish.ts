import { HookfishServer } from '@hookfish/api'
import { Hookfish, HookfishError } from '@hookfish/sdk'
import OpenAI from 'openai'
import { z } from 'zod'

import { databaseReady, hookfishDatabase } from '@/lib/database'
import { type ChatModel } from '@/lib/models'

const vaultValueSchema = z.object({ value: z.string() })
const vaultListSchema = z.object({
  secrets: z.array(z.object({ path: z.string() })),
})

function sdkData(response: unknown): unknown {
  if (
    typeof response === 'object' &&
    response !== null &&
    Reflect.has(response, 'data')
  ) {
    return Reflect.get(response, 'data')
  }
  return response
}

function requireBrokerKey() {
  const apiKey = process.env.HOOKFISH_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('HOOKFISH_API_KEY is required.')
  }
  return apiKey
}

export const hookfishServerPromise = databaseReady.then(() =>
  HookfishServer.init({
    db: hookfishDatabase,
    providers: {},
    includeSwagger: true,
  }),
)

export const hookfishClientPromise = hookfishServerPromise.then(
  (server) =>
    new Hookfish({
      apiKey: requireBrokerKey(),
      baseUrl: 'http://hookfish.local/api',
      fetch: async (input, init) => {
        const request = new Request(input, init)
        return server.fetch(request, process.env)
      },
    }),
)

export function openAISecretPaths(userId: string) {
  const prefix = `users/${userId}/openai`
  return {
    baseUrl: `${prefix}/base-url`,
    apiKey: `${prefix}/api-key`,
  }
}

export async function getOpenAICredentials(userId: string) {
  const hookfish = await hookfishClientPromise
  const paths = openAISecretPaths(userId)

  const baseUrl = await hookfish.secrets.get(paths.baseUrl)
  const apiKey = await hookfish.secrets.get(paths.apiKey)

  return {
    baseUrl: vaultValueSchema.parse(sdkData(baseUrl)).value,
    apiKey: vaultValueSchema.parse(sdkData(apiKey)).value,
  }
}

export async function getOpenAISettings(userId: string) {
  const hookfish = await hookfishClientPromise
  const paths = openAISecretPaths(userId)

  let baseUrl = 'https://api.openai.com/v1'
  try {
    const response = await hookfish.secrets.get(paths.baseUrl)
    baseUrl = vaultValueSchema.parse(sdkData(response)).value
  } catch (error) {
    if (!(error instanceof HookfishError && error.status === 404)) throw error
  }

  const metadata = await hookfish.secrets.list({ path_prefix: paths.apiKey })
  const secrets = vaultListSchema.parse(sdkData(metadata)).secrets
  return {
    baseUrl,
    hasApiKey: secrets.some((secret) => secret.path === paths.apiKey),
  }
}

export async function listOpenAIModelsForCredentials(credentials: {
  baseUrl: string
  apiKey: string
}): Promise<ChatModel[]> {
  const client = new OpenAI({
    apiKey: credentials.apiKey,
    baseURL: credentials.baseUrl,
  })
  const models = await client.models.list()

  return models.data
    .map((model) => ({ id: model.id, name: model.id }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export async function listOpenAIModels(userId: string): Promise<ChatModel[]> {
  return listOpenAIModelsForCredentials(await getOpenAICredentials(userId))
}
