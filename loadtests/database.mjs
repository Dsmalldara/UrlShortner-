import { Pool } from 'pg'

export const databaseName = process.env.LOADTEST_DATABASE ?? 'url_shortener_loadtest'

// These tools must never seed or reset the app's development database.
if (!/^[a-z][a-z0-9_]*_loadtest$/.test(databaseName)) {
  throw new Error('LOADTEST_DATABASE must end in _loadtest and contain only lowercase letters, numbers, and underscores')
}

export const connectionOptions = {
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? '5432'),
  user: process.env.PGUSER ?? process.env.USER,
  password: process.env.PGPASSWORD,
  max: 1,
  connectionTimeoutMillis: 5000,
  application_name: 'url-shortener-loadtest-tools',
}

export const createLoadPool = () => new Pool({ ...connectionOptions, database: databaseName })
