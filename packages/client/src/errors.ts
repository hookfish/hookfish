/** An error that can be returned directly by the authenticated client facade. */
export class HookfishClientError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'HookfishClientError'
    this.status = status
    this.code = code
  }
}
