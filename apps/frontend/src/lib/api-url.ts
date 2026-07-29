const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL

/**
 * Empty string = same origin (Hono is mounted on the frontend at `/api/*`).
 * Override with `VITE_API_BASE_URL` when pointing at a standalone API process.
 */
export const apiBaseUrl = (configuredApiBaseUrl ?? '').replace(/\/$/, '')

export const apiDocsUrl = `${apiBaseUrl}/api`
