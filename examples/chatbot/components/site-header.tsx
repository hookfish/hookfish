import Link from 'next/link'

import { AccountNav } from '@/components/account-nav'

export function SiteHeader() {
  return (
    <header className="flex items-center justify-between gap-2 px-6 py-3">
      <Link href="/" className="text-sm font-medium">
        Hookfish chat
      </Link>
      <AccountNav />
    </header>
  )
}
