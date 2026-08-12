import { KeyRoundIcon } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

export function BrokerAccess({
  token,
  onTokenChange,
}: {
  token: string
  onTokenChange: (token: string) => void
}) {
  return (
    <Button
      variant={token ? 'secondary' : 'outline'}
      size="sm"
      onClick={() => {
        if (token) onTokenChange('')
      }}
    >
      <KeyRoundIcon />
      <span className="hidden sm:inline">
        {token ? 'Clear access' : 'Broker access'}
      </span>
    </Button>
  )
}

export function BrokerAccessPrompt({
  onTokenChange,
}: {
  onTokenChange: (token: string) => void
}) {
  const [draft, setDraft] = useState('')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const token = draft.trim()
    if (token) onTokenChange(token)
  }

  return (
    <section className="grid h-full place-items-center p-4 md:p-8">
      <div className="grid w-full max-w-xl gap-8 border-t-2 border-t-primary bg-card p-8">
        <div>
          <p className="text-xs tracking-widest text-foreground/40 uppercase">
            Connections
          </p>
          <h1 className="mt-2 text-3xl font-light tracking-tight">
            Broker API key required
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-foreground/70">
            Enter a root or scoped broker API key to load connection metadata.
            The key stays in this browser session.
          </p>
        </div>
        <form
          className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end"
          onSubmit={submit}
        >
          <Field>
            <FieldLabel htmlFor="connections-broker-token">
              Broker API key
            </FieldLabel>
            <Input
              id="connections-broker-token"
              type="password"
              value={draft}
              required
              autoComplete="off"
              onChange={(event) => setDraft(event.target.value)}
            />
          </Field>
          <Button type="submit">
            <KeyRoundIcon />
            Open connections
          </Button>
        </form>
      </div>
    </section>
  )
}
