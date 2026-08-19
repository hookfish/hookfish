export const defaultFrontendHostname = 'localhost'

export function resolveBackendUrl(
  configuredBackendUrl: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const backendUrl =
    configuredBackendUrl?.trim() || environment.HOOKFISH_BACKEND_URL?.trim()
  if (!backendUrl) {
    throw new Error(
      '--backend-url or HOOKFISH_BACKEND_URL is required to serve the dashboard.',
    )
  }

  const parsedBackendUrl = new URL(backendUrl)
  if (!['http:', 'https:'].includes(parsedBackendUrl.protocol)) {
    throw new Error('--backend-url must use http or https.')
  }

  return backendUrl
}
