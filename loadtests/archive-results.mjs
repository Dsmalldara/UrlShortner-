import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { gzipSync, gunzipSync } from 'node:zlib'

// Preserve the evidence selected for docs/performance-results.md.
const runs = [
  '2026-09-16T18-50-35-538Z-fea50fea-301',
  '2026-09-16T23-16-39-759Z-faef85bc-301',
  '2026-09-16T23-31-04-717Z-1bfdfc02-301',
  '2026-09-16T17-51-55-633Z-57ff6a54-301',
]

for (const run of runs) {
  const source = new URL(`./results/${run}/`, import.meta.url)
  const destination = new URL(`../docs/reports/${run}/`, import.meta.url)
  const artifacts = []
  for (const name of ['summary.json', 'metadata.json', 'resources.jsonl', 'report.html']) {
    let contents = await readFile(new URL(name, source), 'utf8')
    if (name === 'report.html') {
      const pattern = /(<script id="data"[^>]*>)([\s\S]*?)(<\/script>)/
      const match = contents.match(pattern)
      if (!match) throw new Error(`Missing embedded dashboard data: ${run}`)
      const data = gunzipSync(Buffer.from(match[2].trim(), 'base64')).toString('utf8')
      // Only replace the source script's absolute path; leave metrics untouched.
      const sanitized = data.replace(/"scriptPath":"[^"\r\n]*"/g,
        '"scriptPath":"loadtests/soak.js"')
      const encoded = gzipSync(sanitized).toString('base64')
      contents = contents.replace(pattern, () => match[1] + encoded + match[3])
      if (/\/Users\/|\/home\//.test(sanitized)) {
        throw new Error(`Unexpected personal path remains in report: ${run}`)
      }
    }
    artifacts.push([name, contents])
  }
  await mkdir(destination, { recursive: true })
  for (const [name, contents] of artifacts) {
    const target = new URL(name, destination)
    const existing = await readFile(target, 'utf8').catch((error) => {
      if (error.code !== 'ENOENT') throw error
      return null
    })
    if (existing !== null) {
      if (existing !== contents) throw new Error(`Refusing to overwrite differing archive: ${run}/${name}`)
      continue
    }
    await writeFile(target, contents, { flag: 'wx' })
  }
  console.log(`Archived ${run}`)
}
