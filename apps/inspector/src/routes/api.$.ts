import { createFileRoute } from '@tanstack/react-router'
import { handleHookfishRequest } from '../lib/hookfish.server'

const handle = ({ request }: { request: Request }) =>
  handleHookfishRequest(request)

export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      DELETE: handle,
      GET: handle,
      HEAD: handle,
      OPTIONS: handle,
      PATCH: handle,
      POST: handle,
      PUT: handle,
    },
  },
})
