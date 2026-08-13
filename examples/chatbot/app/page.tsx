import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { Chat } from '@/components/chat'
import { auth } from '@/lib/auth'
import { databaseReady } from '@/lib/database'
import { getOpenAISettings, listOpenAIModels } from '@/lib/hookfish'

export const metadata: Metadata = {
  title: 'Chat',
  description:
    'A per-user chatbot powered by Hookfish, Better Auth, and PGlite.',
}

export default async function Page() {
  await databaseReady
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/sign-in')

  const settings = await getOpenAISettings(session.user.id)
  if (!settings.hasApiKey) redirect('/settings')

  let models: Awaited<ReturnType<typeof listOpenAIModels>>
  try {
    models = await listOpenAIModels(session.user.id)
  } catch {
    redirect('/settings?connection=invalid')
  }

  return <Chat models={models} />
}
