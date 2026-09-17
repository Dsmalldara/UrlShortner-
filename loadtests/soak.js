import http from 'k6/http'
import { check } from 'k6'
import { SharedArray } from 'k6/data'
import execution from 'k6/execution'
import { Trend } from 'k6/metrics'

const targets = new SharedArray('existing URLs', () => JSON.parse(open('./data/urls.json')).urls)
const baseUrl = __ENV.BASE_URL ?? 'http://127.0.0.1:3001'
const runId = __ENV.RUN_ID ?? String(Date.now())
const status = Number(__ENV.REDIRECT_STATUS ?? 301)
const rate = Number(__ENV.RATE ?? 40)
const hotShare = Number(__ENV.HOT_SHARE ?? 0.8)
const preAllocatedVUs = Number(__ENV.PREALLOCATED_VUS ?? 20)
const maxVUs = Number(__ENV.MAX_VUS ?? 100)
if (!Number.isInteger(rate) || rate < 4 || rate % 4 !== 0) throw new Error('RATE must be a positive multiple of 4')
if (status !== 301 && status !== 302) throw new Error('REDIRECT_STATUS must be 301 or 302')
if (hotShare < 0 || hotShare > 1 || !Number.isFinite(hotShare)) throw new Error('HOT_SHARE must be between 0 and 1')
if (!Number.isInteger(preAllocatedVUs) || preAllocatedVUs < 1 || !Number.isInteger(maxVUs) || maxVUs < preAllocatedVUs) {
  throw new Error('VU counts must be positive integers, with MAX_VUS >= PREALLOCATED_VUS')
}
if (targets.length < 100) throw new Error('Prepare at least 100 seed URLs first')

const creationLatency = new Trend('creation_latency_ms', true)
const redirectLatency = new Trend('redirect_latency_ms', true)
const writeRate = rate / 4
const hotCount = Math.max(1, Math.floor(targets.length * 0.01))

const scenario = (targetRate, startRate, exec) => ({
  executor: 'ramping-arrival-rate',
  exec,
  startRate,
  timeUnit: '1s',
  preAllocatedVUs,
  maxVUs,
  stages: [
    { duration: __ENV.WARMUP ?? '10s', target: targetRate },
    { duration: __ENV.DURATION ?? '30s', target: targetRate },
  ],
  gracefulStop: '10s',
})
const initialWriteRate = Math.max(1, Math.floor(writeRate / 10))

export const options = {
  scenarios: {
    creations: scenario(writeRate, initialWriteRate, 'createUrl'),
    redirects: scenario(writeRate * 3, initialWriteRate * 3, 'redirectUrl'),
  },
  discardResponseBodies: true,
  // Suppress unique URL tags so millions of writes do not produce millions of series.
  systemTags: ['status', 'method', 'name', 'scenario', 'expected_response', 'error_code'],
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(95)', 'p(99)'],
  thresholds: {
    'checks{operation:create}': ['rate>=0.999'],
    'checks{operation:redirect}': ['rate>=0.999'],
    http_req_failed: ['rate<0.01'],
    dropped_iterations: ['count==0'],
    // Set a latency budget explicitly after calibration rather than inventing an SLO.
    ...(__ENV.P95_MS ? {
      creation_latency_ms: [`p(95)<${Number(__ENV.P95_MS)}`],
      redirect_latency_ms: [`p(95)<${Number(__ENV.P95_MS)}`],
    } : {}),
  },
}

export function setup() {
  const target = targets[0]
  const response = http.get(`${baseUrl}/expand?shortUrl=${target.shortUrl}`, {
    redirects: 0, timeout: '5s', tags: { name: 'GET /expand preflight' },
  })
  if (response.status !== status || response.headers.Location !== target.longUrl) {
    throw new Error(`Preflight failed: expected ${status} and the seeded URL; received ${response.status}`)
  }
}

export function createUrl() {
  const padding = 'a'.repeat(40 + Math.floor(Math.random() * 240))
  const longUrl = `https://write.example.test/articles/${runId}/${execution.scenario.iterationInTest}?campaign=${padding}&source=k6`
  const tags = { name: 'POST /shorten', operation: 'create' }
  const response = http.post(`${baseUrl}/shorten?url=${encodeURIComponent(longUrl)}`, null, {
    timeout: '5s', responseType: 'text', tags,
  })
  creationLatency.add(response.timings.duration)
  let code
  try { code = response.json('shortUrl') } catch { /* The check below records malformed responses. */ }
  check(response, {
    'creates URL with 201': (result) => result.status === 201,
    'returns a valid short code': () => typeof code === 'string' && /^[0-9a-zA-Z]{1,7}$/.test(code),
  }, tags)
}

export function redirectUrl() {
  const hot = Math.random() < hotShare
  const index = hot
    ? Math.floor(Math.random() * hotCount)
    : hotCount + Math.floor(Math.random() * (targets.length - hotCount))
  const target = targets[index]
  const tags = { name: 'GET /expand', operation: 'redirect', access: hot ? 'hot' : 'cold' }
  const response = http.get(`${baseUrl}/expand?shortUrl=${target.shortUrl}`, {
    redirects: 0, timeout: '5s', tags,
  })
  redirectLatency.add(response.timings.duration)
  check(response, {
    'returns expected redirect status': (result) => result.status === status,
    'redirects to the correct URL': (result) => result.headers.Location === target.longUrl,
  }, tags)
}

export function handleSummary(data) {
  const latencyLine = (name) => {
    const values = data.metrics[name]?.values ?? {}
    const format = (value) => Number(value ?? 0).toFixed(2)
    return `${name}: p50=${format(values.med)}ms p95=${format(values['p(95)'])}ms p99=${format(values['p(99)'])}ms`
  }
  const directory = __ENV.RESULTS_DIR ?? '.'
  return {
    [`${directory}/summary.json`]: JSON.stringify(data, null, 2),
    stdout: `\n${latencyLine('creation_latency_ms')}\n${latencyLine('redirect_latency_ms')}\n` +
      `Requests: ${data.metrics.http_reqs?.values.count ?? 0}; dropped iterations: ${data.metrics.dropped_iterations?.values.count ?? 0}\n` +
      `Check success: ${((data.metrics.checks?.values.rate ?? 0) * 100).toFixed(2)}%\n` +
      `Results saved in ${directory}\n`,
  }
}
