# Hookfish chatbot example

This example adapts the [shadcn chatbot template](https://github.com/shadcn-ui/chatbot-template) to use a separate OpenAI-compatible connection for every signed-in person.

- Better Auth provides email/password sessions.
- Hookfish encrypts each person's OpenAI base URL and API key.
- One PGlite socket server stores both Better Auth and Hookfish tables and safely serves Next.js route workers.
- The model selector is populated from the configured provider with `client.models.list()`.
- The API key stays on the server. The browser only sees whether a key is configured.

The upstream chatbot UI remains under the MIT license in `LICENSE`.

## Run it

From this directory, create the local environment file:

```sh
cp .env.example .env.local
openssl rand -base64 32
openssl rand -base64 32
```

Use the generated values for `BETTER_AUTH_SECRET` and `OAUTH_ENCRYPTION_KEY`.
Keep the sample `HOOKFISH_API_KEY` for local development, or replace it with another private value.

Install dependencies and start the app from the repository root:

```sh
pnpm install
pnpm --filter @hookfish/example-chatbot dev
```

Open <http://localhost:3000>, create an email/password account, and add your OpenAI connection in **Settings**.

Use the package scripts instead of invoking `next` directly. They start one PGlite socket server, run migrations, and then start Next.js with an injected `DATABASE_URL`. This prevents Next.js development reloads from opening the same single-connection PGlite data directory more than once.

## How credentials are isolated

The authenticated Better Auth user ID becomes part of each Hookfish vault path:

```text
users/<better-auth-user-id>/openai/base-url
users/<better-auth-user-id>/openai/api-key
```

The settings and chat route handlers verify the Better Auth session before selecting those paths. The chat handler retrieves both values from Hookfish in server code and creates an AI SDK OpenAI provider for that request.

PGlite is intended here for local development. Use a shared Postgres deployment before running multiple application instances.
