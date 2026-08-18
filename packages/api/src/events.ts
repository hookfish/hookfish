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
  occurredAt: Date
  providerId?: string
  connectionPath?: string
  tokenName?: string
  errorCode?: string
  refreshed?: boolean
  replayed?: boolean
  /** Authenticated application user, when initiated through `/api/client`. */
  subject?: string
  /** Authenticated application tenant, when initiated through `/api/client`. */
  tenantId?: string
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
