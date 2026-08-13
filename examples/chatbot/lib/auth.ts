import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'

import * as authSchema from '@/lib/auth-schema'
import { authDatabase } from '@/lib/database'

export const auth = betterAuth({
  appName: 'Hookfish chatbot',
  database: drizzleAdapter(authDatabase, {
    provider: 'pg',
    schema: authSchema,
  }),
  emailAndPassword: {
    enabled: true,
  },
})
