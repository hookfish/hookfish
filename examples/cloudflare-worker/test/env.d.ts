declare module 'cloudflare:test' {
  // Give the test runtime the bindings generated from wrangler.jsonc.
  interface ProvidedEnv extends Env {}
}
