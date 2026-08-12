---
"@hookfish/provider": minor
"@hookfish/api": minor
"@hookfish/sdk": minor
"@hookfish/provider-mcp": minor
"@hookfish/provider-github": patch
"@hookfish/provider-linear": patch
"@hookfish/provider-notion": patch
"hookfish": minor
---

Describe connection providers with OAuth or secret authentication and a small
input schema, accept generic non-secret connection configuration, and generate
the updated SDK contract. New projects now include only the generic MCP and
secret providers by default. Connection configuration and requested OAuth
scopes are separate inputs; the legacy MCP `url` shorthand and provider
`configurable` metadata are removed.
