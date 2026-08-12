import { HookfishError } from '@hookfish/sdk'
import {
  APIConnectionError,
  APIError,
  AuthenticationError,
  PermissionDeniedError,
} from 'openai'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { databaseReady } from '@/lib/database'
import {
  getOpenAICredentials,
  getOpenAISettings,
  hookfishClientPromise,
  listOpenAIModelsForCredentials,
  openAISecretPaths,
} from '@/lib/hookfish'

const settingsSchema = z.object({
  baseUrl: z
    .url()
    .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
      message: 'Base URL must use http or https.',
    }),
  apiKey: z.string().trim().min(1).max(65_536).optional(),
})

async function currentUser(request: Request) {
  await databaseReady
  const session = await auth.api.getSession({ headers: request.headers })
  return session?.user
}

function connectionErrorMessage(error: unknown) {
  if (error instanceof AuthenticationError) {
    return 'The provider rejected that API key.'
  }
  if (error instanceof PermissionDeniedError) {
    return 'That API key cannot list models.'
  }
  if (error instanceof APIConnectionError) {
    return 'Could not connect to the provider. Check the base URL.'
  }
  if (error instanceof APIError) {
    if (error.status === 404) {
      return 'The base URL does not expose an OpenAI-compatible models endpoint.'
    }
    return `The provider returned HTTP ${error.status} while listing models.`
  }
  return 'Could not validate this OpenAI connection.'
}

export async function GET(request: Request) {
  const user = await currentUser(request)
  if (!user) {
    return Response.json({ error: 'Sign in required.' }, { status: 401 })
  }

  return Response.json(await getOpenAISettings(user.id))
}

export async function PUT(request: Request) {
  const user = await currentUser(request)
  if (!user) {
    return Response.json({ error: 'Sign in required.' }, { status: 401 })
  }

  let input: z.infer<typeof settingsSchema>
  try {
    input = settingsSchema.parse(await request.json())
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof z.ZodError
            ? (error.issues[0]?.message ?? 'Invalid settings.')
            : 'Invalid JSON body.',
      },
      { status: 400 },
    )
  }

  const hookfish = await hookfishClientPromise
  const paths = openAISecretPaths(user.id)
  let apiKey = input.apiKey

  if (!apiKey) {
    try {
      apiKey = (await getOpenAICredentials(user.id)).apiKey
    } catch (error) {
      if (!(error instanceof HookfishError && error.status === 404)) throw error
      return Response.json(
        { error: 'API key is required the first time you save settings.' },
        { status: 400 },
      )
    }
  }

  let models: Awaited<ReturnType<typeof listOpenAIModelsForCredentials>>
  try {
    models = await listOpenAIModelsForCredentials({
      baseUrl: input.baseUrl,
      apiKey,
    })
  } catch (error) {
    return Response.json(
      { error: connectionErrorMessage(error) },
      { status: 400 },
    )
  }

  if (models.length === 0) {
    return Response.json(
      { error: 'The provider returned no available models.' },
      { status: 400 },
    )
  }

  await hookfish.secrets.put(paths.baseUrl, input.baseUrl)
  if (input.apiKey) {
    await hookfish.secrets.put(paths.apiKey, input.apiKey)
  }

  return Response.json({
    baseUrl: input.baseUrl,
    hasApiKey: true,
    modelCount: models.length,
  })
}

export async function DELETE(request: Request) {
  const user = await currentUser(request)
  if (!user) {
    return Response.json({ error: 'Sign in required.' }, { status: 401 })
  }

  const hookfish = await hookfishClientPromise
  const paths = openAISecretPaths(user.id)
  await hookfish.secrets.delete(paths.baseUrl)
  await hookfish.secrets.delete(paths.apiKey)

  return new Response(null, { status: 204 })
}
