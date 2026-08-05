import { postgres } from '@hookfish/database/postgres'
import { createHookfishConfig } from '../../hookfish.shared'

const migrationUrl = process.env.HOOKFISH_MIGRATION_DATABASE_URL

const db = migrationUrl
  ? postgres<Env>(migrationUrl)
  : postgres<Env>((bindings) => bindings.HYPERDRIVE.connectionString, {
      cache: false,
      fetchTypes: false,
      max: 5,
      prepare: true,
    })

export default createHookfishConfig<Env>({ db })
