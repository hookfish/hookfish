export type InspectorServerConfig = {
  host: string
  port: number
  origin: string
}

function parsePort(value: string | undefined): number | undefined {
  if (!value) return undefined
  const port = Number(value)
  return Number.isInteger(port) && port > 0 && port < 65_535 ? port : undefined
}

function conductorInspectorPort(value: string | undefined) {
  const allocatedPort = parsePort(value)
  if (!allocatedPort || allocatedPort >= 65_533) return undefined
  return allocatedPort + 2
}

function browserHostname(host: string) {
  if (host === '127.0.0.1' || host === '0.0.0.0' || host === '::') {
    return 'localhost'
  }
  return host.includes(':') ? `[${host}]` : host
}

export function inspectorServerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): InspectorServerConfig {
  const host = environment.INSPECTOR_HOST ?? '127.0.0.1'
  const port =
    parsePort(environment.INSPECTOR_PORT) ??
    conductorInspectorPort(environment.CONDUCTOR_PORT) ??
    parsePort(environment.PORT) ??
    3000
  const origin =
    environment.HOOKFISH_INSPECTOR_URL?.trim() ||
    `http://${browserHostname(host)}:${port}`

  return { host, port, origin }
}
