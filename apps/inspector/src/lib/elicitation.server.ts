import { randomUUID } from 'node:crypto'
import type {
  ElicitRequestFormParams,
  ElicitRequestURLParams,
  ElicitResult,
} from '@modelcontextprotocol/client'
import '@tanstack/react-start/server-only'

export type PendingElicitation =
  | {
      id: string
      mode: 'form'
      message: string
      requestedSchema: ElicitRequestFormParams['requestedSchema']
    }
  | {
      id: string
      mode: 'url'
      message: string
      elicitationId?: string
      url: string
    }

type CompatibleElicitRequestParams =
  | ElicitRequestFormParams
  | (Omit<ElicitRequestURLParams, 'elicitationId'> & {
      // The 2026-07-28 protocol removed this field and its completion
      // notification. Frozen 2025-11-25 servers still send it.
      elicitationId?: string
    })

type PendingInteraction = {
  request: PendingElicitation
  resolve: (result: ElicitResult) => void
  timeout: ReturnType<typeof setTimeout>
}

type ElicitationOperation = {
  pending?: PendingInteraction
  completedUrlElicitations: Set<string>
  updateWaiters: Set<(update: ElicitationUpdate) => void>
}

export type ElicitationUpdate =
  | { state: 'pending'; request: PendingElicitation }
  | { state: 'finished' }

const interactionTimeoutMs = 15 * 60 * 1000
const operations = new Map<string, ElicitationOperation>()

function operation(actionId: string) {
  const current = operations.get(actionId)
  if (current) return current
  const created: ElicitationOperation = {
    completedUrlElicitations: new Set(),
    updateWaiters: new Set(),
  }
  operations.set(actionId, created)
  return created
}

function normalizeRequest(
  id: string,
  params: CompatibleElicitRequestParams,
): PendingElicitation {
  if (params.mode === 'url') {
    return {
      id,
      mode: 'url',
      message: params.message,
      elicitationId: params.elicitationId,
      url: params.url,
    }
  }
  return {
    id,
    mode: 'form',
    message: params.message,
    requestedSchema: params.requestedSchema,
  }
}

export function beginElicitationOperation(actionId: string) {
  operation(actionId)
}

function notifyUpdate(
  current: ElicitationOperation,
  update: ElicitationUpdate,
) {
  for (const resolve of current.updateWaiters) resolve(update)
  current.updateWaiters.clear()
}

export function waitForElicitation(
  actionId: string,
  params: CompatibleElicitRequestParams,
): Promise<ElicitResult> {
  const current = operation(actionId)
  if (
    params.mode === 'url' &&
    params.elicitationId !== undefined &&
    current.completedUrlElicitations.delete(params.elicitationId)
  ) {
    return Promise.resolve({ action: 'accept' })
  }

  if (current.pending) {
    clearTimeout(current.pending.timeout)
    current.pending.resolve({ action: 'cancel' })
  }

  return new Promise((resolve) => {
    const id = randomUUID()
    const timeout = setTimeout(() => {
      const latest = operations.get(actionId)
      if (latest?.pending?.request.id === id) latest.pending = undefined
      resolve({ action: 'cancel' })
    }, interactionTimeoutMs)
    current.pending = {
      request: normalizeRequest(id, params),
      resolve,
      timeout,
    }
    notifyUpdate(current, {
      state: 'pending',
      request: current.pending.request,
    })
  })
}

export function waitForElicitationUpdate(
  actionId: string,
  lastRequestId?: string,
): Promise<ElicitationUpdate> {
  const current = operations.get(actionId)
  if (!current) return Promise.resolve({ state: 'finished' })
  if (current.pending && current.pending.request.id !== lastRequestId) {
    return Promise.resolve({
      state: 'pending',
      request: current.pending.request,
    })
  }
  return new Promise((resolve) => current.updateWaiters.add(resolve))
}

export function respondToElicitation(
  actionId: string,
  requestId: string,
  result: ElicitResult,
) {
  const current = operations.get(actionId)
  if (!current?.pending || current.pending.request.id !== requestId) {
    return false
  }
  const { pending } = current
  current.pending = undefined
  clearTimeout(pending.timeout)
  pending.resolve(result)
  return true
}

export function completeUrlElicitation(
  actionId: string,
  elicitationId: string,
) {
  const current = operation(actionId)
  if (
    current.pending?.request.mode === 'url' &&
    current.pending.request.elicitationId === elicitationId
  ) {
    respondToElicitation(actionId, current.pending.request.id, {
      action: 'accept',
    })
    return
  }
  current.completedUrlElicitations.add(elicitationId)
}

export function finishElicitationOperation(actionId: string) {
  const current = operations.get(actionId)
  if (!current) return
  operations.delete(actionId)
  notifyUpdate(current, { state: 'finished' })
  if (!current.pending) return
  clearTimeout(current.pending.timeout)
  current.pending.resolve({ action: 'cancel' })
}
