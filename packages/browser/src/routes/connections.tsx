import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/connections')({
  component: ConnectionsLayout,
})

function ConnectionsLayout() {
  return <Outlet />
}
