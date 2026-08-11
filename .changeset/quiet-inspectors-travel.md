---
'hookfish': minor
'@hookfish/provider-mcp': patch
---

Bundle the MCP inspector with the CLI so `npx hookfish inspect` and `npx hookfish inspector` start at `https://inspector.localhost` through Portless, replace an existing process on that route, and use correct OAuth callbacks. Localhost OAuth clients now use dynamic registration so remote authorization servers can validate the inspector callback. The CLI now requires Node.js 24 or newer to match Portless.
