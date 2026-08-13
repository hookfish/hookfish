export type HookfishEvent = {
  type:
    | 'authorization.started'
    | 'authorization.connected'
    | 'authorization.failed'
    | 'connection.secret_accessed'
    | 'connection.secret_stored'
    | 'connection.disconnected'
    | 'broker_token.created'
    | 'broker_token.revoked'
    | 'secret.stored'
    | 'secret.retrieved'
    | 'secret.deleted'
  occurredAt: Date
  providerId?: string
  connectionPath?: string
  tokenName?: string
  secretPath?: string
  errorCode?: string
  refreshed?: boolean
  replayed?: boolean
}

export type HookfishEventHandler = (
  event: HookfishEvent,
) => void | Promise<void>

/**
 * Audit/event delivery is deliberately best-effort: an unavailable telemetry
 * sink must not turn a completed OAuth exchange into a failed callback.
 */
export async function emitHookfishEvent(
  handler: HookfishEventHandler | undefined,
  event: HookfishEvent,
): Promise<void> {
  if (!handler) return

  try {
    await handler(event)
  } catch (error) {
    console.error('hookfish event handler error', error)
  }
}
