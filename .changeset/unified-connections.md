---
'@hookfish/api': minor
'@hookfish/database': minor
'@hookfish/hooks': minor
'@hookfish/provider': minor
'@hookfish/provider-mcp': minor
'@hookfish/providers': minor
'@hookfish/sdk': minor
'hookfish': minor
---

Replace caller-defined OAuth connections and dynamic providers with one unified
connection API. Connection paths now end in a trusted provider ID, OAuth access
returns a fresh authorization URL whenever authorization is required, static
secrets use the built-in `secret` provider, and dynamic MCP servers use the
built-in `mcp` provider with connection-local configuration and client
credentials. The SDK's `mcpAuthProvider()` integrates connection access and
upstream MCP reauthorization without route-level authorization catches.
