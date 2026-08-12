import {
  ChevronRightIcon,
  FolderIcon,
  PlugZapIcon,
  Trash2Icon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { connectionDirectory } from '@/lib/connection-tree'
import { hookfish } from '@/lib/hookfish'

export function OAuthConnections({
  managementToken,
  currentPath,
  onNavigate,
}: {
  managementToken: string
  currentPath: string
  onNavigate: (path: string) => void
}) {
  const connections = hookfish.useConnections(
    currentPath ? { namespace: currentPath } : {},
  )
  const disconnect = hookfish.useDisconnectConnection()
  const directory = connectionDirectory(
    connections.data?.connections ?? [],
    currentPath,
  )
  const crumbs = currentPath ? currentPath.split('/') : []

  return (
    <section className="mx-auto h-full max-w-6xl overflow-y-auto px-4 py-8 md:px-8">
      <div className="flex flex-wrap items-start justify-between gap-6 border-b pb-6">
        <div>
          <p className="text-xs tracking-widest text-foreground/40 uppercase">
            Connections
          </p>
          <h2 className="mt-2 text-3xl font-light tracking-tight">
            {currentPath || 'All namespaces'}
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-foreground/65">
            This dashboard displays metadata only. Applications call{' '}
            <code>connections.access(path)</code> on their server to receive a
            secret or a fresh authorization URL.
          </p>
        </div>
        <span className="rounded-full border px-3 py-1 text-xs text-foreground/55">
          {managementToken ? 'Broker access active' : 'Read only'}
        </span>
      </div>

      <nav
        className="flex flex-wrap items-center gap-1 py-5 text-sm"
        aria-label="Connection path"
      >
        <button
          type="button"
          className="text-foreground/60 hover:text-foreground"
          onClick={() => onNavigate('')}
        >
          root
        </button>
        {crumbs.map((crumb, index) => {
          const path = crumbs.slice(0, index + 1).join('/')
          return (
            <span key={path} className="flex items-center gap-1">
              <ChevronRightIcon className="size-3 text-foreground/35" />
              <button
                type="button"
                className="hover:underline"
                onClick={() => onNavigate(path)}
              >
                {crumb}
              </button>
            </span>
          )
        })}
      </nav>

      {connections.isPending ? (
        <p className="py-16 text-sm text-foreground/55">Loading connections…</p>
      ) : connections.error ? (
        <p className="border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {connections.error.message}
        </p>
      ) : directory.folders.length === 0 &&
        directory.connections.length === 0 ? (
        <div className="border border-dashed p-10 text-center">
          <PlugZapIcon className="mx-auto size-7 text-foreground/35" />
          <p className="mt-4 text-sm text-foreground/60">
            No connections in this namespace yet.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {directory.folders.map((folder) => (
            <button
              key={folder.path}
              type="button"
              className="flex items-center gap-3 border p-4 text-left hover:bg-muted/50"
              onClick={() => onNavigate(folder.path)}
            >
              <FolderIcon className="size-5 text-foreground/45" />
              <span className="flex-1 font-medium">{folder.name}</span>
              <span className="text-xs text-foreground/45">
                {folder.itemCount}
              </span>
              <ChevronRightIcon className="size-4 text-foreground/35" />
            </button>
          ))}
          {directory.connections.map((connection) => (
            <article
              key={connection.path}
              className="flex items-center gap-4 border p-4"
            >
              <PlugZapIcon className="size-5 text-foreground/45" />
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-medium">{connection.path}</h3>
                <p className="mt-1 text-xs text-foreground/50">
                  Provider: {connection.provider_id}
                  {connection.external_account_label
                    ? ` · ${connection.external_account_label}`
                    : ''}
                </p>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Disconnect ${connection.path}`}
                disabled={disconnect.isPending}
                onClick={() => disconnect.mutate(connection.path)}
              >
                <Trash2Icon />
              </Button>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
