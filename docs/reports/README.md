# Selected benchmark evidence

These four runs support the [performance write-up](../performance-results.md).
They are intentionally included in the repository. Other generated runs remain
under the ignored `loadtests/results/` directory.

| Run directory (UTC) | Pool maximum | Offered requests/s | Hold duration |
| --- | ---: | ---: | --- |
| [2026-09-16T18-50-35-538Z-fea50fea-301](2026-09-16T18-50-35-538Z-fea50fea-301/) | 5 | 2,000 | 10 min |
| [2026-09-16T23-16-39-759Z-faef85bc-301](2026-09-16T23-16-39-759Z-faef85bc-301/) | 5 | 3,240 | 10 min |
| [2026-09-16T23-31-04-717Z-1bfdfc02-301](2026-09-16T23-31-04-717Z-1bfdfc02-301/) | 5 | 4,632 | 10 min |
| [2026-09-16T17-51-55-633Z-57ff6a54-301](2026-09-16T17-51-55-633Z-57ff6a54-301/) | 20 | 1,100 | 30 min |

Each directory contains:

- `summary.json`: request counts, failures, checks, thresholds, and latency percentiles.
- `metadata.json`: workload settings, versions, machine specifications, source hashes,
  initial/final row counts, and exit status.
- `resources.jsonl`: resource and database samples taken approximately every five seconds.
- `report.html`: the standalone interactive k6 dashboard.

GitHub's file view displays HTML source rather than running the dashboard. Download
`report.html` and open it in a browser, or clone the repository and open it locally.

The JSON and JSONL files are exact copies of the original artifacts. In each HTML
report, the embedded `scriptPath` has been changed from an absolute local filesystem
path to `loadtests/soak.js`. The dashboard measurements are unchanged. The original
reports remain in `loadtests/results/` on the machine that ran the tests.

The archive can be recreated from those originals with
`node loadtests/archive-results.mjs`. The script needs all four source directories;
it does not run tests or connect to PostgreSQL, and refuses to overwrite differing
archived files. Future benchmarks should be saved separately from this evidence.
