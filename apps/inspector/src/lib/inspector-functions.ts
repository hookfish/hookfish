import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

const httpUrl = z.url().refine((value) => {
  const protocol = new URL(value).protocol
  return protocol === 'http:' || protocol === 'https:'
}, 'MCP server URL must use HTTP or HTTPS.')

const connectionInput = z.object({
  url: httpUrl,
  connectionId: z.string().min(1).optional(),
})

const toolInput = connectionInput.extend({
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
})

const resourceInput = connectionInput.extend({
  uri: z.string().min(1),
})

const promptInput = connectionInput.extend({
  name: z.string().min(1),
  arguments: z.record(z.string(), z.string()),
})

const authorizeInput = z.object({
  url: httpUrl,
  label: z.string().trim().min(1).max(128),
})

const jsonValue = z.json()

const serverInfo = z
  .object({
    name: z.string(),
    version: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    websiteUrl: z.string().optional(),
  })
  .nullable()

const tool = z
  .object({
    name: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    inputSchema: jsonValue,
    outputSchema: jsonValue.optional(),
    annotations: jsonValue.optional(),
    execution: jsonValue.optional(),
    icons: jsonValue.optional(),
    _meta: jsonValue.optional(),
  })
  .catchall(jsonValue)

const resource = z.object({
  uri: z.string(),
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
})

const resourceTemplate = z.object({
  uriTemplate: z.string(),
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
})

const prompt = z.object({
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  arguments: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        required: z.boolean().optional(),
      }),
    )
    .optional(),
})

export const inspectorSnapshotSchema = z.object({
  serverInfo,
  capabilities: jsonValue,
  instructions: z.string().nullable(),
  protocolVersion: z.string().nullable(),
  protocolEra: z.string().nullable(),
  transport: z.enum(['Streamable HTTP', 'HTTP + SSE']),
  tools: z.array(tool),
  resources: z.array(resource),
  resourceTemplates: z.array(resourceTemplate),
  prompts: z.array(prompt),
})

export type InspectorSnapshot = z.infer<typeof inspectorSnapshotSchema>

function serializableJson(value: unknown) {
  return jsonValue.parse(JSON.parse(JSON.stringify(value)))
}

async function requestOrigin() {
  const { getRequest } = await import('@tanstack/react-start/server')
  return new URL(getRequest().url).origin
}

export const inspectMcpServer = createServerFn({ method: 'POST' })
  .validator((input) => connectionInput.parse(input))
  .handler(async ({ data }) => {
    const inspector = await import('./mcp.server')
    return inspectorSnapshotSchema.parse(
      await inspector.inspectServer(data, await requestOrigin()),
    )
  })

export const executeMcpTool = createServerFn({ method: 'POST' })
  .validator((input) => toolInput.parse(input))
  .handler(async ({ data }) => {
    const inspector = await import('./mcp.server')
    return serializableJson(
      await inspector.executeTool(data, await requestOrigin()),
    )
  })

export const readMcpResource = createServerFn({ method: 'POST' })
  .validator((input) => resourceInput.parse(input))
  .handler(async ({ data }) => {
    const inspector = await import('./mcp.server')
    return serializableJson(
      await inspector.readResource(data, await requestOrigin()),
    )
  })

export const renderMcpPrompt = createServerFn({ method: 'POST' })
  .validator((input) => promptInput.parse(input))
  .handler(async ({ data }) => {
    const inspector = await import('./mcp.server')
    return serializableJson(
      await inspector.renderPrompt(data, await requestOrigin()),
    )
  })

export const authorizeMcpServer = createServerFn({ method: 'POST' })
  .validator((input) => authorizeInput.parse(input))
  .handler(async ({ data }) => {
    const inspector = await import('./mcp.server')
    return inspector.authorizeServer(data, await requestOrigin())
  })
