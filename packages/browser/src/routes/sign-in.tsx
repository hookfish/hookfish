import { createFileRoute } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useHookfishBrowserConfig } from '@/config'

export const Route = createFileRoute('/sign-in')({ component: SignIn })

function SignIn() {
  const { SignInComponent, signInUrl } = useHookfishBrowserConfig()
  if (SignInComponent) return <SignInComponent />

  return (
    <main className="grid min-h-[calc(100svh-4rem)] place-items-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            Authentication is managed by the application hosting Hookfish.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <a href={signInUrl}>Continue to sign in</a>
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
