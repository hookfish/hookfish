import { KeyRoundIcon } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

export function BrokerAccess({
  token,
  onTokenChange,
}: {
  token: string
  onTokenChange: (token: string) => void
}) {
  const [draft, setDraft] = useState(token)
  const [open, setOpen] = useState(false)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextToken = draft.trim()
    if (!nextToken) return
    onTokenChange(nextToken)
    setOpen(false)
  }

  function clear() {
    setDraft('')
    onTokenChange('')
    setOpen(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setDraft(token)
        setOpen(nextOpen)
      }}
    >
      <DialogTrigger asChild>
        <Button variant={token ? 'secondary' : 'outline'} size="sm">
          <KeyRoundIcon />
          <span className="hidden sm:inline">
            {token ? 'Access active' : 'Broker access'}
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form className="grid gap-8" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Broker access</DialogTitle>
            <DialogDescription>
              Enter a root or scoped broker API key. It is kept for this browser
              session.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="broker-token">Broker API key</FieldLabel>
            <Input
              id="broker-token"
              type="password"
              value={draft}
              required
              autoComplete="off"
              placeholder="Enter a broker API key…"
              onChange={(event) => setDraft(event.target.value)}
            />
          </Field>
          <DialogFooter>
            {token ? (
              <Button type="button" variant="outline" onClick={clear}>
                Clear access
              </Button>
            ) : null}
            <Button type="submit">
              <KeyRoundIcon />
              {token ? 'Update access' : 'Enable access'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
