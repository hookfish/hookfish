'use client'

import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Settings = {
  baseUrl: string
  hasApiKey: boolean
}

export function CredentialSettings({
  initial,
  initialMessage,
}: {
  initial: Settings
  initialMessage?: string
}) {
  const [baseUrl, setBaseUrl] = React.useState(initial.baseUrl)
  const [apiKey, setApiKey] = React.useState('')
  const [hasApiKey, setHasApiKey] = React.useState(initial.hasApiKey)
  const [message, setMessage] = React.useState<string | undefined>(
    initialMessage,
  )
  const [pending, startTransition] = React.useTransition()

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(undefined)

    startTransition(async () => {
      const response = await fetch('/api/settings/openai', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl,
          apiKey: apiKey.trim() || undefined,
        }),
      })
      const body = await response.json()

      if (!response.ok) {
        setMessage(body.error ?? 'Could not save settings.')
        return
      }

      setApiKey('')
      setHasApiKey(true)
      setMessage(
        `Saved. Found ${body.modelCount} ${body.modelCount === 1 ? 'model' : 'models'}. Your API key is encrypted by Hookfish.`,
      )
    })
  }

  return (
    <form
      className="w-full max-w-lg space-y-5 rounded-3xl border bg-card p-6 shadow-sm"
      onSubmit={save}
    >
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">OpenAI connection</h1>
        <p className="text-sm text-muted-foreground">
          These values are stored in Hookfish under your Better Auth user ID.
          The API key is never returned to the browser.
        </p>
      </div>

      <label className="block space-y-1.5 text-sm" htmlFor="openai-base-url">
        <span>Base URL</span>
        <Input
          id="openai-base-url"
          placeholder="https://api.openai.com/v1"
          required
          type="url"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
      </label>
      <label className="block space-y-1.5 text-sm" htmlFor="openai-api-key">
        <span>API key</span>
        <Input
          id="openai-api-key"
          autoComplete="off"
          placeholder={hasApiKey ? 'Leave blank to keep the saved key' : 'sk-…'}
          required={!hasApiKey}
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
        />
      </label>

      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      <div className="flex items-center gap-3">
        <Button disabled={pending} type="submit">
          {pending ? 'Saving…' : 'Save connection'}
        </Button>
        {hasApiKey && (
          <span className="text-sm text-muted-foreground">API key saved</span>
        )}
      </div>
    </form>
  )
}
