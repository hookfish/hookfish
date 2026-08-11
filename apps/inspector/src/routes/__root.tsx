import { createRootRoute, HeadContent, Scripts } from '@tanstack/react-router'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Hookfish MCP Inspector',
      },
      {
        name: 'description',
        content:
          'Inspect and execute tools, resources, and prompts on any MCP server.',
      },
      {
        name: 'theme-color',
        content: '#fafaf9',
      },
      {
        name: 'color-scheme',
        content: 'light dark',
      },
    ],
    links: [
      {
        rel: 'preconnect',
        href: 'https://fonts.googleapis.com',
      },
      {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@300;400;600&display=swap',
      },
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  notFoundComponent: NotFound,
  shellComponent: RootDocument,
})

function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-stone-50 px-6 text-stone-950 dark:bg-stone-950 dark:text-stone-50">
      <div>
        <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[#C8102E]">
          404 / Not found
        </p>
        <h1 className="text-4xl font-light tracking-[-0.035em]">
          Nothing to inspect here.
        </h1>
        <a
          href="/"
          className="mt-6 inline-flex min-h-11 items-center border-b-2 border-[#C8102E] text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#C8102E]"
        >
          Return to inspector
        </a>
      </div>
    </main>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="scheme-light dark:scheme-dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}

        <Scripts />
      </body>
    </html>
  )
}
