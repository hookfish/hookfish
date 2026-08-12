import { migrateDatabases, sqlClient } from '../lib/database'

try {
  await migrateDatabases()
} finally {
  await sqlClient.end()
}
