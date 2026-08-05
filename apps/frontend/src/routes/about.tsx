import { createFileRoute } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export const Route = createFileRoute('/about')({
  component: About,
})

function About() {
  return (
    <main className="max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>About this stack</CardTitle>
          <CardDescription>
            A portable React SPA backed by a Fetch-compatible API.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm text-muted-foreground">
          <p>
            TanStack Router owns client-side navigation. The frontend can point
            at any Hookfish backend runtime without importing server code.
          </p>
          <p>
            A browser-safe facade keeps broker credentials on the backend while
            Node, Cloudflare Workers, and future runtimes choose their own
            database adapters.
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
