import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'

export type StubTokenResponse = {
  access_token: string
  token_type?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  account_id?: string
  account_label?: string
}

export type OAuthStub = {
  baseUrl: string
  authorizeUrl: string
  tokenUrl: string
  /** Codes issued by the authorize endpoint, awaiting exchange. */
  pendingCodes: Map<string, { redirectUri: string; scopes: string }>
  /** Override the next token response (authorization_code or refresh). */
  nextTokenResponse: StubTokenResponse | null
  /** Force the next token request to fail with this status. */
  nextTokenStatus: number | null
  /** Return a non-JSON body on the next token call (still HTTP 200). */
  nextTokenNonJson: boolean
  /** Delay token responses so tests can overlap requests. */
  tokenDelayMs: number
  tokenRequests: Array<{
    grantType: string
    body: Record<string, string>
    authorization: string | undefined
    contentType: string | undefined
  }>
  close: () => Promise<void>
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function parseTokenBody(
  req: IncomingMessage,
): Promise<Record<string, string>> {
  const raw = await readBody(req)
  const contentType = req.headers['content-type'] ?? ''

  if (contentType.includes('application/json')) {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') out[key] = value
    }
    return out
  }

  const params = new URLSearchParams(raw)
  const out: Record<string, string> = {}
  for (const [key, value] of params) out[key] = value
  return out
}

/**
 * Minimal OAuth2 authorize + token endpoints. Real HTTP — the broker talks to
 * this with global `fetch`, same as Notion/Linear/Google.
 */
export async function startOAuthStub(): Promise<OAuthStub> {
  const pendingCodes = new Map<
    string,
    { redirectUri: string; scopes: string }
  >()
  const tokenRequests: OAuthStub['tokenRequests'] = []

  const stub: OAuthStub = {
    baseUrl: '',
    authorizeUrl: '',
    tokenUrl: '',
    pendingCodes,
    nextTokenResponse: null,
    nextTokenStatus: null,
    nextTokenNonJson: false,
    tokenDelayMs: 0,
    tokenRequests,
    close: async () => undefined,
  }

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', stub.baseUrl)

    if (req.method === 'GET' && url.pathname === '/authorize') {
      const redirectUri = url.searchParams.get('redirect_uri')
      const state = url.searchParams.get('state')
      const scopes = url.searchParams.get('scope') ?? ''

      if (!redirectUri || !state) {
        res.writeHead(400, { 'content-type': 'text/plain' })
        res.end('missing redirect_uri or state')
        return
      }

      const code = randomBytes(16).toString('hex')
      pendingCodes.set(code, { redirectUri, scopes })

      const destination = new URL(redirectUri)
      destination.searchParams.set('code', code)
      destination.searchParams.set('state', state)
      res.writeHead(302, { location: destination.toString() })
      res.end()
      return
    }

    if (req.method === 'POST' && url.pathname === '/token') {
      const body = await parseTokenBody(req)
      tokenRequests.push({
        grantType: body.grant_type ?? '',
        body,
        authorization: req.headers.authorization,
        contentType: req.headers['content-type'],
      })

      if (stub.tokenDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, stub.tokenDelayMs))
      }

      if (stub.nextTokenStatus !== null) {
        const status = stub.nextTokenStatus
        stub.nextTokenStatus = null
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'invalid_grant' }))
        return
      }

      if (stub.nextTokenNonJson) {
        stub.nextTokenNonJson = false
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end('not-json')
        return
      }

      if (body.grant_type === 'authorization_code') {
        const pending = body.code ? pendingCodes.get(body.code) : undefined
        if (!pending) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'invalid_grant' }))
          return
        }
        pendingCodes.delete(body.code)
      }

      const custom = stub.nextTokenResponse
      stub.nextTokenResponse = null

      const payload: StubTokenResponse = custom ?? {
        access_token: `access-${randomBytes(8).toString('hex')}`,
        token_type: 'Bearer',
        refresh_token: `refresh-${randomBytes(8).toString('hex')}`,
        expires_in: 3600,
        scope: 'read write',
        account_id: 'acct_stub',
        account_label: 'Stub Account',
      }

      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
      return
    }

    res.writeHead(404)
    res.end()
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('OAuth stub failed to bind a port')
  }

  stub.baseUrl = `http://127.0.0.1:${address.port}`
  stub.authorizeUrl = `${stub.baseUrl}/authorize`
  stub.tokenUrl = `${stub.baseUrl}/token`
  stub.close = () =>
    new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })

  return stub
}
