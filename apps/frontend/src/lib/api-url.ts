const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL

export const apiBaseUrl = (
  configuredApiBaseUrl ?? (import.meta.env.DEV ? 'http://localhost:8787' : '')
).replace(/\/$/, '')

export const apiDocsUrl = `${apiBaseUrl}/api`
