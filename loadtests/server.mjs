import { serve } from '@hono/node-server'
import { createHono } from '../dist/createHono.js'
import { pool } from '../dist/db.js'
import { databaseName } from './database.mjs'

const status = Number(process.env.REDIRECT_STATUS ?? 301)
if (status !== 301 && status !== 302) throw new Error('REDIRECT_STATUS must be 301 or 302')

const connected = await pool.query('SELECT current_database() AS name')
if (connected.rows[0].name !== databaseName) throw new Error('Load server connected to the wrong database')

const app = createHono(status)
const server = serve({
  fetch: app.fetch,
  hostname: '127.0.0.1',
  port: Number(process.env.LOADTEST_PORT ?? 3001),
}, (info) => {
  console.log(`Load server: http://127.0.0.1:${info.port}; DB: ${databaseName}; redirects: ${status}`)
  process.send?.({ type: 'ready', port: info.port })
})

let stopping = false
const stop = () => {
  if (stopping) return
  stopping = true
  server.close(async () => {
    await pool.end()
    process.exit(0)
  })
}
server.on('error', async (error) => {
  console.error(error.message)
  await pool.end()
  process.exit(1)
})
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
