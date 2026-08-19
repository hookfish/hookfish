# Documentation project instructions

## About this project

- This is the external developer documentation for Hookfish
- Hookfish is a portable OAuth and encrypted-secret broker
- This is a documentation site built on [Mintlify](https://mintlify.com)
- Pages are MDX files with YAML frontmatter
- Configuration lives in `docs.json`
- Use the Mintlify MCP server, `https://mcp.mintlify.com`, to edit content and settings via MCP
- Use the Mintlify docs MCP server, `https://www.mintlify.com/docs/mcp`, to query information about using Mintlify via MCP

## Terminology

- Use **Hookfish** as the public product and repository name.
- Use **connection** for one linked account at an OAuth provider.
- Use **OAuth provider** for GitHub, Linear, Notion, remote MCP servers, and custom integrations.
- Use **application auth provider** for Auth.js, Clerk, Auth0, Supabase Auth, and similar identity systems.
- Distinguish a **broker access token** from an upstream **provider access token**.
- Use **resource scope** for Hookfish's hierarchical authorization paths.
- Use **provider scope** for permissions requested from an OAuth provider.
- Use **client API** for the allowlisted Hono app mounted at `/api/client`.

## Style preferences

{/* Add any project-specific style rules below */}

- Use active voice and second person ("you")
- Keep sentences concise — one idea per sentence
- Use sentence case for headings
- Bold for UI elements: Click **Settings**
- Code formatting for file names, commands, paths, and code references

## Content boundaries

- Write for external developers installing published packages, not contributors running this monorepo.
- Keep contributor commands and repository maintenance details out of the public docs.
- Do not imply that browser code can retrieve provider tokens or secret values.
- Do not imply that an application auth provider returns or exposes a broker credential.
- Prefer `hookfish init` for standalone deployment quickstarts. Use manual setup instructions when embedding Hookfish into an existing application.
