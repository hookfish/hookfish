import { createServerFn } from '@tanstack/react-start'

export type HealthResponse = {
  ok: boolean
  runtime: string
  checkedAt: string
}

export type CreateMessageResponse = {
  id: string
  text: string
  createdAt: string
}

type CreateMessageInput = {
  text: string
}

export const getHealth = createServerFn({ method: 'GET' }).handler(
  async (): Promise<HealthResponse> => {
    return {
      ok: true,
      runtime: 'tanstack-start-server-function',
      checkedAt: new Date().toISOString(),
    }
  },
)

export const createMessage = createServerFn({ method: 'POST' })
  .validator((input: unknown): CreateMessageInput => {
    if (
      typeof input !== 'object' ||
      input === null ||
      !('text' in input) ||
      typeof input.text !== 'string'
    ) {
      throw new Error('Message text is required')
    }

    const text = input.text.trim()

    if (!text) {
      throw new Error('Message text is required')
    }

    return { text }
  })
  .handler(async ({ data }): Promise<CreateMessageResponse> => {
    return {
      id: crypto.randomUUID(),
      text: data.text,
      createdAt: new Date().toISOString(),
    }
  })
