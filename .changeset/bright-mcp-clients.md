---
'@hookfish/sdk': minor
---

Create authenticated GitHub and Streamable HTTP MCP clients with
`hookfish.github(connection)` and `hookfish.mcp(options)`. Hookfish injects
connection credentials and handles fresh authorization after an upstream MCP
`401`. Callers can provide an unconnected MCP `Client` when they need custom
capabilities or client options. Returned MCP clients support `await using` for
automatic cleanup.
