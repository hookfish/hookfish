'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'

export function AccountNav() {
  const router = useRouter()
  const { data: session } = authClient.useSession()

  if (!session) return null

  return (
    <nav className="flex items-center gap-2" aria-label="Account">
      <span className="hidden text-sm text-muted-foreground sm:inline">
        {session.user.name}
      </span>
      <Button
        render={<Link href="/settings" />}
        nativeButton={false}
        variant="ghost"
      >
        Settings
      </Button>
      <Button
        render={<Link href="/" />}
        nativeButton={false}
        variant="secondary"
      >
        New chat
      </Button>
      <Button
        variant="ghost"
        onClick={async () => {
          await authClient.signOut()
          router.push('/sign-in')
          router.refresh()
        }}
      >
        Sign out
      </Button>
    </nav>
  )
}
