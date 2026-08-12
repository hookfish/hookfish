'use client'

import { useRouter } from 'next/navigation'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { authClient } from '@/lib/auth-client'

export function AuthForm() {
  const router = useRouter()
  const [mode, setMode] = React.useState<'sign-in' | 'sign-up'>('sign-in')
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [error, setError] = React.useState<string>()
  const [pending, startTransition] = React.useTransition()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(undefined)

    startTransition(async () => {
      const normalizedEmail = email.trim().toLowerCase()
      const result =
        mode === 'sign-in'
          ? await authClient.signIn.email({
              email: normalizedEmail,
              password,
            })
          : await authClient.signUp.email({
              email: normalizedEmail,
              name: normalizedEmail.split('@')[0] || normalizedEmail,
              password,
            })

      if (result.error) {
        setError(result.error.message ?? 'Authentication failed.')
        return
      }

      router.push('/')
      router.refresh()
    })
  }

  return (
    <div className="w-full max-w-sm rounded-3xl border bg-card p-6 shadow-sm">
      <div className="mb-6 space-y-1">
        <h1 className="text-xl font-semibold">
          {mode === 'sign-in' ? 'Sign in' : 'Create an account'}
        </h1>
        <p className="text-sm text-muted-foreground">
          Use your email address and password.
        </p>
      </div>

      <form className="space-y-4" onSubmit={submit}>
        <label className="block space-y-1.5 text-sm" htmlFor="email">
          <span>Email</span>
          <Input
            id="email"
            autoComplete="email"
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="block space-y-1.5 text-sm" htmlFor="password">
          <span>Password</span>
          <Input
            id="password"
            autoComplete={
              mode === 'sign-in' ? 'current-password' : 'new-password'
            }
            minLength={8}
            required
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button className="w-full" disabled={pending} type="submit">
          {pending
            ? 'Working…'
            : mode === 'sign-in'
              ? 'Sign in'
              : 'Create account'}
        </Button>
      </form>

      <button
        className="mt-4 w-full text-sm text-muted-foreground underline-offset-4 hover:underline"
        type="button"
        onClick={() => {
          setError(undefined)
          setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')
        }}
      >
        {mode === 'sign-in' ? 'Create an account' : 'Use an existing account'}
      </button>
    </div>
  )
}
