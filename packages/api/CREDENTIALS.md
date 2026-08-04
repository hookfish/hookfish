# Credential vault

The credential vault stores user-supplied API keys and request headers as
application-encrypted database records. It is intended for secrets that must be
recovered for trusted server-side use. Login passwords should instead use a
one-way password hash and do not belong here.

## Configuration

```sh
openssl rand -base64 32 # -> CREDENTIALS_ENCRYPTION_KEY
```

Set these bindings in the Hookfish runtime:

| Binding | Required | Purpose |
| --- | --- | --- |
| `CREDENTIALS_ENCRYPTION_KEY` | Yes | 32 random bytes, base64-encoded; separate from the OAuth key |
| `CREDENTIALS_OWNER_ID` | No | Owner applied to every credential query; defaults to `system` |
| `BROKER_API_KEY` | In production | Protects all credential routes |

`CREDENTIALS_OWNER_ID` is a static, single-owner bridge for the current shared
API-key deployment. When the host gains per-user authentication, replace this
configuration lookup with an owner resolved from verified session/JWT context.
Do not accept an owner id directly from an untrusted request.

Changing `CREDENTIALS_ENCRYPTION_KEY` makes existing credentials unreadable.
The stored `encryption_version` and per-record authenticated context provide a
safe format for a future KMS/envelope-encryption rotation workflow, but this
first pass does not rewrap old records automatically.

## API

All routes require `Authorization: Bearer $BROKER_API_KEY`.

### Store headers

```sh
curl -X POST https://broker.example/api/credentials \
  -H "Authorization: Bearer $BROKER_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{
    "name": "Acme production",
    "kind": "headers",
    "headers": {
      "Authorization": "Bearer secret-value",
      "X-API-Key": "another-secret"
    }
  }'
```

Header names are normalized to lowercase. Headers that control HTTP routing or
message framing, including `Host`, `Content-Length`, `Transfer-Encoding`, and
forwarding headers, are rejected.

### Store an opaque value

```sh
curl -X POST https://broker.example/api/credentials \
  -H "Authorization: Bearer $BROKER_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"name":"Acme API key","kind":"opaque","value":"secret-value"}'
```

Create, list, detail, and update responses contain metadata only:

```json
{
  "credential": {
    "id": "1b0bf9f4-1479-48bb-a59e-e8d15af0e3f6",
    "name": "Acme production",
    "kind": "headers",
    "fields": ["authorization", "x-api-key"],
    "created_at": "2026-08-03T12:00:00.000Z",
    "updated_at": "2026-08-03T12:00:00.000Z",
    "last_used_at": null
  }
}
```

| Method | Route | Behavior |
| --- | --- | --- |
| `POST` | `/api/credentials` | Encrypt and store a credential |
| `GET` | `/api/credentials?kind=headers` | List metadata for the configured owner |
| `GET` | `/api/credentials/{id}` | Read metadata only |
| `PUT` | `/api/credentials/{id}` | Fully replace and re-encrypt the credential |
| `POST` | `/api/credentials/{id}/resolve` | Return plaintext for immediate trusted server-side use |
| `DELETE` | `/api/credentials/{id}` | Delete the credential |

The resolve endpoint is deliberately a `POST`, updates `last_used_at`, and sets
`Cache-Control: no-store` and `Pragma: no-cache`. Do not call it directly from a
browser or log its response. Prefer having a trusted backend consume the value
and make the downstream API request.

## Security model

- Payloads use AES-256-GCM with a fresh 96-bit nonce.
- Owner id, credential id, kind, and encryption version are authenticated as
  additional data, so ciphertext cannot be moved to another record or tenant.
- Secret values never appear in list/detail responses or non-secret columns.
- Every database read, update, resolve, and delete includes the owner id.
- The encryption key remains outside the database.

This protects a database dump without the runtime key. It cannot protect
secrets from a compromised Hookfish process that is authorized to decrypt them.
For production multi-tenant deployments, place the root key in KMS or a secrets
manager, restrict decrypt permission to the broker runtime, and audit decrypt
operations.
