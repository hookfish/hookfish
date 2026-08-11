import { createFileRoute } from '@tanstack/react-router'
import { McpInspector } from '../components/mcp-inspector'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return <McpInspector />
}
