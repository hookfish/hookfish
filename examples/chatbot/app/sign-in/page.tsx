import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { AuthForm } from '@/components/auth-form'
import { auth } from '@/lib/auth'
import { databaseReady } from '@/lib/database'

export default async function SignInPage() {
  await databaseReady
  const session = await auth.api.getSession({ headers: await headers() })
  if (session) redirect('/')

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <AuthForm />
    </main>
  )
}
