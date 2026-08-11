import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import {
  beginElicitationOperation,
  finishElicitationOperation,
  respondToElicitation,
  waitForElicitationUpdate,
} from './elicitation.server'
import {
  defaultInspectorFeatures,
  inspectorFeaturesSchema,
} from './inspector-features'
import {
  authorizeServer,
  executeTool,
  inspectServer,
  readResource,
  renderPrompt,
} from './mcp.server'
import { inspectorPublicOrigin } from './public-origin.server'

const httpUrl = z.url().refine((value) => {
  const protocol = new URL(value).protocol
  return protocol === 'http:' || protocol === 'https:'
}, 'MCP server URL must use HTTP or HTTPS.')

const connectionInput = z.object({
  url: httpUrl,
  connectionId: z.string().min(1).optional(),
  features: inspectorFeaturesSchema.default(defaultInspectorFeatures),
})

const interactiveConnectionInput = connectionInput.extend({
  actionId: z.uuid(),
})

const toolInput = interactiveConnectionInput.extend({
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
})

const resourceInput = interactiveConnectionInput.extend({
  uri: z.string().min(1),
})

const promptInput = interactiveConnectionInput.extend({
  name: z.string().min(1),
  arguments: z.record(z.string(), z.string()),
})

const authorizeInput = z.object({
  url: httpUrl,
  label: z.string().trim().min(1).max(128),
})

const jsonValue = z.json()

const elicitationRequest = z.discriminatedUnion('mode', [
  z.object({
    id: z.uuid(),
    mode: z.literal('form'),
    message: z.string(),
    requestedSchema: jsonValue,
  }),
  z.object({
    id: z.uuid(),
    mode: z.literal('url'),
    message: z.string(),
    elicitationId: z.string().optional(),
    url: z.url(),
  }),
])

const elicitationResult = z.object({
  action: z.enum(['accept', 'decline', 'cancel']),
  content: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
    )
    .optional(),
})

const elicitationActionInput = z.object({ actionId: z.uuid() })
const elicitationWaitInput = elicitationActionInput.extend({
  lastRequestId: z.uuid().optional(),
})
const elicitationResponseInput = elicitationActionInput.extend({
  requestId: z.uuid(),
  result: elicitationResult,
})

export type InspectorElicitation = z.infer<typeof elicitationRequest>

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

function requestOrigin() {
  return inspectorPublicOrigin(getRequest().url)
}

export const inspectMcpServer = createServerFn({ method: 'POST' })
  .validator((input) => connectionInput.parse(input))
  .handler(async ({ data }) => {
    return inspectorSnapshotSchema.parse(
      await inspectServer(data, requestOrigin()),
    )
  })

export const executeMcpTool = createServerFn({ method: 'POST' })
  .validator((input) => toolInput.parse(input))
  .handler(async ({ data }) => {
    return serializableJson(await executeTool(data, requestOrigin()))
  })

export const readMcpResource = createServerFn({ method: 'POST' })
  .validator((input) => resourceInput.parse(input))
  .handler(async ({ data }) => {
    return serializableJson(await readResource(data, requestOrigin()))
  })

export const renderMcpPrompt = createServerFn({ method: 'POST' })
  .validator((input) => promptInput.parse(input))
  .handler(async ({ data }) => {
    return serializableJson(await renderPrompt(data, requestOrigin()))
  })

export const authorizeMcpServer = createServerFn({ method: 'POST' })
  .validator((input) => authorizeInput.parse(input))
  .handler(async ({ data }) => {
    return authorizeServer(data, requestOrigin())
  })

export const beginMcpElicitation = createServerFn({ method: 'POST' })
  .validator((input) => elicitationActionInput.parse(input))
  .handler(({ data }) => {
    beginElicitationOperation(data.actionId)
  })

export const waitForMcpElicitation = createServerFn({ method: 'POST' })
  .validator((input) => elicitationWaitInput.parse(input))
  .handler(async ({ data }) => {
    const update = await waitForElicitationUpdate(
      data.actionId,
      data.lastRequestId,
    )
    if (update.state === 'finished') return update
    try {
      return {
        state: update.state,
        request: elicitationRequest.parse(update.request),
      }
    } catch (error) {
      finishElicitationOperation(data.actionId)
      throw error
    }
  })

export const finishMcpElicitation = createServerFn({ method: 'POST' })
  .validator((input) => elicitationActionInput.parse(input))
  .handler(({ data }) => {
    finishElicitationOperation(data.actionId)
  })

export const respondToMcpElicitation = createServerFn({ method: 'POST' })
  .validator((input) => elicitationResponseInput.parse(input))
  .handler(({ data }) => {
    return {
      accepted: respondToElicitation(
        data.actionId,
        data.requestId,
        data.result,
      ),
    }
  })
