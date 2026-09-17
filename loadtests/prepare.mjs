import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { databaseName, connectionOptions, createLoadPool } from './database.mjs'

const count = Number(process.env.SEED_COUNT ?? 100000)
if (!Number.isSafeInteger(count) || count < 100 || count > 10000000) {
  throw new Error('SEED_COUNT must be an integer between 100 and 10000000')
}
if (process.argv.slice(2).some((argument) => argument !== '--reset')) {
  throw new Error('Only --reset is supported. Set SEED_COUNT to choose the number of rows.')
}

const admin = new Pool({ ...connectionOptions, database: 'postgres' })
try {
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName])
  if (exists.rowCount === 0) {
    await admin.query(`CREATE DATABASE "${databaseName}"`)
    console.log(`Created ${databaseName}`)
  }
} finally {
  await admin.end()
}

// Reuse your existing Base62 encoder, with its pool pointed at the isolated DB.
process.env.PGDATABASE = databaseName
const { base62Conversion } = await import('../dist/store/store.js')
const pool = createLoadPool()
try {
  const table = await pool.query("SELECT to_regclass('public.urls') AS name")
  if (!table.rows[0].name) {
    const migration = await readFile(new URL('../db/migrations/001_create_urls.sql', import.meta.url), 'utf8')
    await pool.query(migration)
    console.log('Applied 001_create_urls.sql')
  }

  if (process.argv.includes('--reset')) {
    await pool.query('TRUNCATE TABLE urls RESTART IDENTITY')
    console.log(`Reset URLs in ${databaseName}`)
  }

  // Seed directly in Postgres; the load run will exercise your HTTP write path.
  // Exclude existing rows before inserting so repeat preparation does not consume IDs.
  await pool.query(`
    WITH candidates AS (
      SELECT 'https://seed.example.test/articles/' || n ||
        '?campaign=' || repeat('a', 40 + (n % 240)::integer) || '&source=k6' AS long_url
      FROM generate_series(1, $1::integer) AS n
    )
    INSERT INTO urls (long_url)
    SELECT candidates.long_url FROM candidates
    WHERE NOT EXISTS (SELECT 1 FROM urls WHERE urls.long_url = candidates.long_url)
    ON CONFLICT (long_url) DO NOTHING
  `, [count])

  const result = await pool.query(`
    SELECT id, long_url FROM urls
    WHERE long_url LIKE 'https://seed.example.test/articles/%'
    ORDER BY id LIMIT $1
  `, [count])
  const urls = result.rows.map((row) => {
    const id = Number(row.id)
    if (!Number.isSafeInteger(id) || id >= 62 ** 7) {
      throw new Error('Seed ID exceeds the supported seven-character range; reset the load-test DB')
    }
    return { shortUrl: base62Conversion(id), longUrl: row.long_url }
  })
  await mkdir(new URL('./data/', import.meta.url), { recursive: true })
  await writeFile(new URL('./data/urls.json', import.meta.url), JSON.stringify({
    database: databaseName,
    preparedAt: new Date().toISOString(),
    count: urls.length,
    urls,
  }))
  const total = await pool.query('SELECT count(*) AS count FROM urls')
  console.log(`Prepared ${urls.length} redirect targets; ${total.rows[0].count} total rows in ${databaseName}`)
  console.log('Saved loadtests/data/urls.json. Next: pnpm load:run')
} finally {
  await pool.end()
}
