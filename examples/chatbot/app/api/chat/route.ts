import { createOpenAI } from '@ai-sdk/openai'
import { HookfishError } from '@hookfish/sdk'
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  validateUIMessages,
} from 'ai'

import { auth } from '@/lib/auth'
import { databaseReady } from '@/lib/database'
import { getOpenAICredentials } from '@/lib/hookfish'
import { type ChatUIMessage, getTools } from '@/tools'

export const maxDuration = 30

const MAX_OUTPUT_TOKENS = 8192

function readBodyField(body: unknown, key: string): unknown {
  if (typeof body !== 'object' || body === null) return undefined
  return Reflect.get(body, key)
}

export async function POST(req: Request) {
  await databaseReady
  const session = await auth.api.getSession({ headers: req.headers })
  if (!session) {
    return Response.json({ error: 'Sign in required.' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const model = readBodyField(body, 'model')
  if (typeof model !== 'string' || !model.trim()) {
    return Response.json(
      { error: 'Choose a model before sending a message.' },
      { status: 400 },
    )
  }
  const modelId = model.trim()

  const tools = getTools()

  let credentials: Awaited<ReturnType<typeof getOpenAICredentials>>
  try {
    credentials = await getOpenAICredentials(session.user.id)
  } catch (error) {
    if (error instanceof HookfishError && error.status === 404) {
      return Response.json(
        { error: 'Add your OpenAI connection in Settings before chatting.' },
        { status: 409 },
      )
    }
    throw error
  }

  const openai = createOpenAI({
    apiKey: credentials.apiKey,
    baseURL: credentials.baseUrl,
  })

  // Validate the shape of every message and tool part before trusting it.
  let messages: ChatUIMessage[]
  try {
    const validated = await validateUIMessages<ChatUIMessage>({
      messages: readBodyField(body, 'messages'),
      tools,
    })
    messages = validated
  } catch {
    return Response.json({ error: 'Invalid messages.' }, { status: 400 })
  }

  const result = streamText({
    model: openai(modelId),
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: isStepCount(5),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    abortSignal: req.signal,
  })

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      sendSources: true,
      onError: () => 'Something went wrong. Please try again.',
    }),
  })
}
