import type { ContentfulStatusCode } from 'hono/utils/http-status'

/** An error with a status code the routes can hand straight back to callers. */
export class BrokerError extends Error {
  readonly status: ContentfulStatusCode
  readonly code: string

  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(message)
    this.name = 'BrokerError'
    this.status = status
    this.code = code
  }
}

export function isBrokerError(error: unknown): error is BrokerError {
  return error instanceof BrokerError
}
