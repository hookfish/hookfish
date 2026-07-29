import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { getStats } from '../lib/hono-api'
import { createMessage, getHealth } from '../lib/server-functions'

export const Route = createFileRoute('/')({
  component: Dashboard,
})

function Dashboard() {
  const queryClient = useQueryClient()
  const [message, setMessage] = useState('Hello from the typed Hono RPC client')

  const healthQuery = useQuery({
    queryKey: ['server-function', 'health'],
    queryFn: () => getHealth(),
  })

  const statsQuery = useQuery({
    queryKey: ['hono-api', 'stats'],
    queryFn: getStats,
  })

  const messageMutation = useMutation({
    mutationFn: (text: string) => createMessage({ data: { text } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['server-function'] })
    },
  })

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    messageMutation.mutate(message)
  }

  return (
    <main className="grid gap-6">
      <section className="grid max-w-3xl gap-3">
        <Badge variant="secondary" className="w-fit">
          Cloudflare-compatible full stack app
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          TanStack Start owns app actions; Hono remains a separate API.
        </h1>
        <p className="text-muted-foreground">
          Health and message creation run through TanStack server functions. The
          Hono API stays independent and exposes one stats endpoint read by the
          frontend.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Health</CardTitle>
            <CardDescription>Current server function response</CardDescription>
          </CardHeader>
          <CardContent>
            {healthQuery.isPending ? (
              <div className="grid gap-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-56" />
              </div>
            ) : null}
            {healthQuery.isError ? (
              <Alert variant="destructive">
                <AlertTitle>Health check failed</AlertTitle>
                <AlertDescription>{healthQuery.error.message}</AlertDescription>
              </Alert>
            ) : null}
            {healthQuery.data ? (
              <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Status</dt>
                <dd className="font-medium">
                  {healthQuery.data.ok ? 'OK' : 'Down'}
                </dd>
                <dt className="text-muted-foreground">Runtime</dt>
                <dd className="font-medium">{healthQuery.data.runtime}</dd>
                <dt className="text-muted-foreground">Checked</dt>
                <dd className="font-medium">
                  {new Date(healthQuery.data.checkedAt).toLocaleString()}
                </dd>
              </dl>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Hono Stats</CardTitle>
            <CardDescription>
              Runtime metadata from the standalone Hono API
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {statsQuery.isPending ? (
              <div className="grid gap-3">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-36" />
              </div>
            ) : null}
            {statsQuery.isError ? (
              <Alert variant="destructive">
                <AlertTitle>Stats request failed</AlertTitle>
                <AlertDescription>{statsQuery.error.message}</AlertDescription>
              </Alert>
            ) : null}
            {statsQuery.data ? (
              <>
                <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">Region</dt>
                  <dd className="font-medium">{statsQuery.data.region}</dd>
                  <dt className="text-muted-foreground">Mode</dt>
                  <dd className="font-medium">{statsQuery.data.uptimeMode}</dd>
                </dl>
                <ul className="flex flex-wrap gap-2">
                  {statsQuery.data.features.map((feature) => (
                    <li key={feature}>
                      <Badge variant="outline">{feature}</Badge>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Typed Mutation</CardTitle>
          <CardDescription>
            Send a message through a TanStack server function.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <form onSubmit={handleSubmit} className="grid gap-2">
            <Label htmlFor="message">Message</Label>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <Input
                id="message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
              <Button type="submit" disabled={messageMutation.isPending}>
                {messageMutation.isPending ? 'Sending' : 'Send'}
              </Button>
            </div>
          </form>
          {messageMutation.data ? (
            <Alert>
              <AlertTitle>Message created</AlertTitle>
              <AlertDescription>
                Created {messageMutation.data.id}: {messageMutation.data.text}
              </AlertDescription>
            </Alert>
          ) : null}
          {messageMutation.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Mutation failed</AlertTitle>
              <AlertDescription>
                {messageMutation.error.message}
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
    </main>
  )
}
