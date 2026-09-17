import { fork, spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { createLoadPool, databaseName } from './database.mjs'

const execFileAsync = promisify(execFile)
const root = fileURLToPath(new URL('../', import.meta.url))
process.chdir(root)

const seed = JSON.parse(await readFile('loadtests/data/urls.json', 'utf8').catch(() => {
  throw new Error('Run pnpm load:prepare first to create the database and seed URLs')
}))
if (seed.database !== databaseName) throw new Error('Seed data belongs to another database; run pnpm load:prepare')
const status = Number(process.env.REDIRECT_STATUS ?? 301)
const rate = Number(process.env.RATE ?? 40)
const port = Number(process.env.LOADTEST_PORT ?? 3001)
if (status !== 301 && status !== 302) throw new Error('REDIRECT_STATUS must be 301 or 302')
if (!Number.isInteger(rate) || rate < 4 || rate % 4 !== 0) throw new Error('RATE must be a positive multiple of 4')
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('LOADTEST_PORT must be between 1024 and 65535')

const k6Version = (await execFileAsync('k6', ['version'])).stdout.trim()
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
const directory = path.join('loadtests/results', `${runId}-${status}`)
await mkdir(directory, { recursive: true })
const env = {
  ...process.env,
  PGDATABASE: databaseName,
  LOADTEST_DATABASE: databaseName,
  LOADTEST_PORT: String(port),
  REDIRECT_STATUS: String(status),
  BASE_URL: `http://127.0.0.1:${port}`,
  RUN_ID: runId,
  RATE: String(rate),
  DURATION: process.env.DURATION ?? '30s',
  WARMUP: process.env.WARMUP ?? '10s',
  RESULTS_DIR: directory,
  K6_WEB_DASHBOARD: 'true',
  K6_WEB_DASHBOARD_PORT: '-1',
  K6_WEB_DASHBOARD_PERIOD: '5s',
  K6_WEB_DASHBOARD_EXPORT: path.join(directory, 'report.html'),
}

const pool = createLoadPool()
const serverLog = createWriteStream(path.join(directory, 'server.log'))
let server
let load
let interval
let pendingSample = Promise.resolve()
let sampling = false
let interrupted = false
let metadata

const stopProcess = async (child) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  await new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 5000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
    child.kill('SIGTERM')
  })
}

// CPU/RSS samples cover the app, k6, and all local PostgreSQL processes.
// Postgres CPU cannot be assigned to a single DB because background workers are shared.
const sample = async () => {
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,pcpu=,rss=,comm='])
  const processes = stdout.split('\n').flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/)
    return match ? [{ pid: Number(match[1]), cpuPercent: Number(match[2]), rssBytes: Number(match[3]) * 1024, command: match[4] }] : []
  })
  const processSample = (pid) => {
    const item = processes.find((item) => item.pid === pid)
    return item ? { pid: item.pid, cpuPercent: item.cpuPercent, rssBytes: item.rssBytes } : null
  }
  const postgres = processes.filter((item) => /(^|\/)postgres(?:\s|:|$)/.test(item.command))
  const stats = await pool.query(`
    SELECT numbackends, xact_commit, xact_rollback, blks_read, blks_hit,
      tup_inserted, tup_fetched, temp_bytes, deadlocks,
      pg_database_size(datname) AS database_bytes
    FROM pg_stat_database WHERE datname = current_database()
  `)
  await appendFile(path.join(directory, 'resources.jsonl'), JSON.stringify({
    time: new Date().toISOString(),
    app: processSample(server?.pid),
    k6: processSample(load?.pid),
    postgresAllProcesses: {
      count: postgres.length,
      cpuPercent: postgres.reduce((sum, item) => sum + item.cpuPercent, 0),
      rssBytesSum: postgres.reduce((sum, item) => sum + item.rssBytes, 0),
    },
    host: { freeMemoryBytes: os.freemem(), loadAverage: os.loadavg() },
    database: stats.rows[0],
  }) + '\n')
}

const interrupt = () => {
  interrupted = true
  load?.kill('SIGINT')
}
process.on('SIGINT', interrupt)
process.on('SIGTERM', interrupt)

try {
  const before = await pool.query('SELECT count(*) AS rows, version() AS version FROM urls')
  const sourceHashes = {}
  for (const filename of ['src/store/store.ts', 'src/routes/url.ts', 'src/createHono.ts', 'src/db.ts', 'db/migrations/001_create_urls.sql', 'loadtests/soak.js']) {
    sourceHashes[filename] = createHash('sha256').update(await readFile(filename)).digest('hex')
  }
  metadata = {
    runId, startedAt: new Date().toISOString(),
    database: databaseName, initialRows: before.rows[0].rows, seedRows: seed.count,
    postgresVersion: before.rows[0].version, k6Version, nodeVersion: process.version,
    machine: { platform: os.platform(), release: os.release(), architecture: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem() },
    workload: { rate, duration: env.DURATION, warmup: env.WARMUP, writeShare: 0.25, redirectShare: 0.75, hotShare: Number(process.env.HOT_SHARE ?? 0.8), hotKeyFraction: 0.01, redirectStatus: status },
    appPoolMaxConnections: Number(process.env.PGPOOL_MAX ?? 10), monitoringConnections: 1,
    preAllocatedVUsPerScenario: Number(process.env.PREALLOCATED_VUS ?? 20),
    maxVUsPerScenario: Number(process.env.MAX_VUS ?? 100),
    p95BudgetMs: process.env.P95_MS ? Number(process.env.P95_MS) : null,
    sourceHashes,
  }
  await writeFile(path.join(directory, 'metadata.json'), JSON.stringify(metadata, null, 2))
  console.log(`DB: ${databaseName}; ${seed.count} seeded targets; redirect status: ${status}`)
  console.log(`Starting at ${rate} requests/s after ${env.WARMUP} warmup, holding for ${env.DURATION}`)
  console.log(`Results: ${directory}`)

  server = fork(path.join(root, 'loadtests/server.mjs'), [], { env, silent: true })
  server.stdout.pipe(serverLog, { end: false })
  server.stderr.pipe(serverLog, { end: false })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Load server did not start; inspect server.log')), 10000)
    const ready = (message) => { if (message.type === 'ready') { clearTimeout(timer); resolve() } }
    server.on('message', ready)
    server.once('error', (error) => { clearTimeout(timer); reject(error) })
    server.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Load server exited (${code}); inspect ${directory}/server.log`)) })
  })
  server.on('exit', (code, signal) => {
    if (load && load.exitCode === null && load.signalCode === null) {
      metadata.error = `Load server stopped during the run (${code ?? signal})`
      load.kill('SIGINT')
    }
  })
  if (interrupted) throw new Error('Run interrupted before k6 started')

  await sample()
  load = spawn('k6', ['run', '--quiet', '--no-usage-report', 'loadtests/soak.js'], { env, stdio: 'inherit' })
  interval = setInterval(() => {
    if (sampling) return
    sampling = true
    pendingSample = sample().catch((error) => {
      console.error(`Resource sampling failed: ${error.message}`)
      metadata.resourceSamplingError = error.message
    }).finally(() => { sampling = false })
  }, 5000)
  const code = await new Promise((resolve, reject) => {
    load.once('error', reject)
    load.once('exit', (code) => resolve(code ?? 1))
  })
  clearInterval(interval)
  await pendingSample
  await sample()
  metadata.k6ExitCode = code
  metadata.finalRows = (await pool.query('SELECT count(*) AS rows FROM urls')).rows[0].rows
  process.exitCode = interrupted ? 130 : metadata.error ? 1 : code
} catch (error) {
  console.error(error.message)
  if (metadata) metadata.error = error.message
  process.exitCode = interrupted ? 130 : 1
} finally {
  clearInterval(interval)
  await pendingSample
  await stopProcess(load)
  await stopProcess(server)
  serverLog.end()
  await pool.end()
  if (metadata) {
    metadata.finishedAt = new Date().toISOString()
    metadata.interrupted = interrupted
    await writeFile(path.join(directory, 'metadata.json'), JSON.stringify(metadata, null, 2))
  }
  process.off('SIGINT', interrupt)
  process.off('SIGTERM', interrupt)
}
