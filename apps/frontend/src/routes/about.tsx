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
            A Cloudflare Workers app with separate TanStack Start and Hono apps.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm text-muted-foreground">
          <p>
            This project targets Cloudflare Workers. TanStack Start renders the
            React frontend and owns app-specific server functions, while Hono
            runs as a standalone API.
          </p>
          <p>
            The frontend reads the single Hono stats endpoint with React Query.
            Mutations and app-owned reads use TanStack server functions instead
            of importing server package types.
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
