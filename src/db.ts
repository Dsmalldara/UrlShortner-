import { Pool } from 'pg'


export const pool = new Pool({
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? '5432'),
  database: process.env.PGDATABASE ?? 'url_shortener',
  user: process.env.PGUSER ?? process.env.USER,
  password: process.env.PGPASSWORD,
  max: Number(process.env.PGPOOL_MAX ?? '10'), // maximum number of clients in the pool
})
