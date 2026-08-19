import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

export function BetterAuthSignIn() {
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(undefined)
    const data = new FormData(event.currentTarget)
    const email = String(data.get('email') ?? '')
    const password = String(data.get('password') ?? '')
    const response = await fetch(
      creating ? '/api/auth/sign-up/email' : '/api/auth/sign-in/email',
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          ...(creating ? { name: String(data.get('name') ?? '') } : {}),
        }),
      },
    )
    if (response.ok) {
      await navigate({ to: '/connections' })
      return
    }
    const body: unknown = await response.json().catch(() => undefined)
    const message =
      body &&
      typeof body === 'object' &&
      typeof Reflect.get(body, 'message') === 'string'
        ? Reflect.get(body, 'message')
        : 'Authentication failed.'
    setError(message)
    setPending(false)
  }

  return (
    <main className="grid min-h-[calc(100svh-4rem)] place-items-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{creating ? 'Create an account' : 'Sign in'}</CardTitle>
          <CardDescription>
            Continue to the Hookfish connection manager.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit}>
            <FieldGroup>
              {creating ? (
                <Field>
                  <FieldLabel htmlFor="name">Name</FieldLabel>
                  <Input id="name" name="name" autoComplete="name" required />
                </Field>
              ) : null}
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete={creating ? 'new-password' : 'current-password'}
                  minLength={8}
                  required
                />
              </Field>
              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}
              <Button type="submit" disabled={pending}>
                {pending
                  ? 'Please wait…'
                  : creating
                    ? 'Create account'
                    : 'Sign in'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setCreating((value) => !value)
                  setError(undefined)
                }}
              >
                {creating ? 'Use an existing account' : 'Create an account'}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
