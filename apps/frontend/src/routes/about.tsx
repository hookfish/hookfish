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
    <main className="h-full overflow-y-auto p-4 md:p-8">
      <Card>
        <CardHeader>
          <CardTitle>About this stack</CardTitle>
          <CardDescription>
            A portable React client backed by a Fetch-compatible API.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm text-muted-foreground">
          <p>
            TanStack Start serves the frontend while the mountable Hookfish
            client forwards safe operations to a separately running API.
          </p>
          <p>
            The browser-safe facade keeps broker credentials on the server while
            each runtime chooses its own database adapter.
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
