import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { CredentialSettings } from '@/components/credential-settings'
import { auth } from '@/lib/auth'
import { databaseReady } from '@/lib/database'
import { getOpenAISettings } from '@/lib/hookfish'

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connection?: string }>
}) {
  await databaseReady
  const requestHeaders = await headers()
  const session = await auth.api.getSession({ headers: requestHeaders })
  if (!session) redirect('/sign-in')

  const initial = await getOpenAISettings(session.user.id)
  const { connection } = await searchParams

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <CredentialSettings
        initial={initial}
        initialMessage={
          connection === 'invalid'
            ? 'The saved connection is no longer valid. Check the base URL and enter a valid API key.'
            : undefined
        }
      />
    </main>
  )
}
