import {
  createProviderRegistry,
  defaultProviderRegistry,
  isProviderRegistry,
  isProviderSource,
  type OAuthProvider,
  type ProviderRegistry,
  type ProviderSource,
  type ProviderSourceEntry,
  type ProviderSourceListResult,
} from '@hookfish/provider'

export type ProviderMap = Record<string, OAuthProvider>

export type ProviderCollection<Bindings extends object = object> =
  | ProviderMap
  | ProviderRegistry
  | ProviderSource<Bindings>

export type ProviderFactory<Bindings extends object> = (
  bindings: Bindings,
) => ProviderCollection<Bindings> | Promise<ProviderCollection<Bindings>>

export type ProviderInput<Bindings extends object = object> =
  | ProviderCollection<Bindings>
  | ProviderFactory<Bindings>

export interface BoundProviderSource {
  getProvider(providerId: string): Promise<OAuthProvider | undefined>
  listProviders(query?: URLSearchParams): Promise<ProviderSourceListResult>
}

function providerEntries(registry: ProviderRegistry): ProviderSourceEntry[] {
  return registry.listProviders().map(([id, provider]) => ({ id, provider }))
}

export function bindProviderRegistry(
  registry: ProviderRegistry,
): BoundProviderSource {
  return {
    getProvider: async (providerId) => registry.getProvider(providerId),
    listProviders: async () => ({ providers: providerEntries(registry) }),
  }
}

export const defaultBoundProviderSource = bindProviderRegistry(
  defaultProviderRegistry,
)

function assertProviderListResult(
  result: ProviderSourceListResult,
): ProviderSourceListResult {
  if (!Array.isArray(result.providers)) {
    throw new TypeError(
      'Provider source listing must return a providers array.',
    )
  }

  for (const entry of result.providers) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof entry.id !== 'string' ||
      !entry.id ||
      typeof entry.provider !== 'object' ||
      entry.provider === null
    ) {
      throw new TypeError(
        'Each provider source listing entry must contain an id and provider.',
      )
    }
  }

  return result
}

function bindProviderCollection<Bindings extends object>(
  collection: ProviderCollection<Bindings>,
  bindings: Bindings,
): BoundProviderSource {
  if (isProviderRegistry(collection)) {
    return bindProviderRegistry(collection)
  }

  if (isProviderSource(collection)) {
    return {
      getProvider: async (providerId) =>
        collection.getProvider(providerId, bindings),
      listProviders: async (query = new URLSearchParams()) => {
        if (!collection.listProviders) return { providers: [] }
        return assertProviderListResult(
          await collection.listProviders(query, bindings),
        )
      },
    }
  }

  const registry = createProviderRegistry(collection)
  return bindProviderRegistry(registry)
}

function memoizeProviderLookups(
  source: BoundProviderSource,
): BoundProviderSource {
  const providers = new Map<string, Promise<OAuthProvider | undefined>>()

  return {
    getProvider(providerId) {
      let pending = providers.get(providerId)
      if (!pending) {
        pending = source.getProvider(providerId)
        providers.set(providerId, pending)
      }
      return pending
    },
    listProviders: (query) => source.listProviders(query),
  }
}

export async function resolveProviderInput<Bindings extends object>(
  input: ProviderInput<Bindings>,
  bindings: Bindings,
): Promise<BoundProviderSource> {
  const collection = typeof input === 'function' ? await input(bindings) : input
  return memoizeProviderLookups(bindProviderCollection(collection, bindings))
}

export function createProviderResolver<Bindings extends object>(
  input: ProviderInput<Bindings>,
): (bindings: Bindings) => Promise<BoundProviderSource> {
  if (typeof input === 'function') {
    return (bindings) => resolveProviderInput(input, bindings)
  }

  const collection =
    isProviderRegistry(input) || isProviderSource(input)
      ? input
      : createProviderRegistry(input)
  return async (bindings) =>
    memoizeProviderLookups(bindProviderCollection(collection, bindings))
}

export async function materializeProviderRegistry(
  source: BoundProviderSource,
): Promise<ProviderRegistry> {
  const result = await source.listProviders(new URLSearchParams())
  return createProviderRegistry(
    Object.fromEntries(
      result.providers.map(({ id, provider }) => [id, provider]),
    ),
  )
}
