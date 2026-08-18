import { createHookfishBrowserRouter } from '@hookfish/browser/router'
import { routeTree } from './routeTree.gen'
import { BetterAuthSignIn } from './sign-in'

export function getRouter() {
  return createHookfishBrowserRouter(routeTree, {
    SignInComponent: BetterAuthSignIn,
  })
}
