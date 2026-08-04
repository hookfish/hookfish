type ErrorResponse = {
  status: number
  statusText: string
  headers: Headers
  text(): Promise<string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function brokerError(body: unknown): { code?: string; message?: string } {
  if (!isRecord(body) || !isRecord(body.error)) return {}

  return {
    code: typeof body.error.code === 'string' ? body.error.code : undefined,
    message:
      typeof body.error.message === 'string' ? body.error.message : undefined,
  }
}

async function readBody(response: ErrorResponse): Promise<unknown> {
  const text = await response.text()
  if (!text) return undefined

  if (response.headers.get('content-type')?.includes('json')) {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  return text
}

export class HookfishApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly body: unknown

  constructor(options: {
    status: number
    statusText: string
    code?: string
    message?: string
    body: unknown
  }) {
    super(options.message ?? `${options.status} ${options.statusText}`.trim())
    this.name = 'HookfishApiError'
    this.status = options.status
    this.code = options.code
    this.body = options.body
  }
}

export async function throwHookfishApiError(
  response: ErrorResponse,
): Promise<never> {
  const body = await readBody(response)
  const error = brokerError(body)

  throw new HookfishApiError({
    status: response.status,
    statusText: response.statusText,
    code: error.code,
    message: error.message,
    body,
  })
}
