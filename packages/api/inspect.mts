import { PGlite } from '@electric-sql/pglite'
const db = new PGlite('/tmp/freshpg')
console.log(
  'indexes:',
  (
    await db.query<{ indexname: string }>(
      "select indexname from pg_indexes where tablename='oauth_connections' order by 1",
    )
  ).rows.map((r) => r.indexname),
)
console.log(
  'columns:',
  (
    await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name='oauth_connections' and column_name in ('user_id','connection_id')",
    )
  ).rows,
)
console.log(
  'journal:',
  (
    await db.query<{ hash: string }>(
      'select count(*)::int as hash from drizzle.__drizzle_migrations',
    )
  ).rows,
)
