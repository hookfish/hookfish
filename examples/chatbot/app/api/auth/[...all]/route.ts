import { toNextJsHandler } from 'better-auth/next-js'

import { auth } from '@/lib/auth'
import { databaseReady } from '@/lib/database'

const handlers = toNextJsHandler(auth)

export async function GET(request: Request) {
  await databaseReady
  return handlers.GET(request)
}

export async function POST(request: Request) {
  await databaseReady
  return handlers.POST(request)
}
