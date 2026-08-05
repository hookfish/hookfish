const configuredBackendUrl =
  import.meta.env.VITE_BACKEND_URL ?? import.meta.env.VITE_API_BASE_URL

/**
 * Empty string uses the Vite development proxy or a same-origin deployment.
 * Override with `VITE_BACKEND_URL` to point the SPA at another backend host.
 */
export const backendUrl = (configuredBackendUrl ?? '').replace(/\/$/, '')

export const browserApiUrl = `${backendUrl}/client`
export const apiDocsUrl = `${backendUrl}/api`
