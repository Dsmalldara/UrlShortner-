# Saved benchmark reports

These runs support the [performance results](../performance-results.md).

| Run | Pool | Rate | Hold |
| --- | ---: | ---: | ---: |
| [2,000 RPS](2026-09-16T18-50-35-538Z-fea50fea-301/) | 5 | 2,000 RPS | 10 min |
| [3,240 RPS](2026-09-16T23-16-39-759Z-faef85bc-301/) | 5 | 3,240 RPS | 10 min |
| [4,632 RPS](2026-09-16T23-31-04-717Z-1bfdfc02-301/) | 5 | 4,632 RPS | 10 min |
| [1,100 RPS endurance](2026-09-16T17-51-55-633Z-57ff6a54-301/) | 20 | 1,100 RPS | 30 min |

Each directory contains the k6 summary, run metadata, resource samples, and an
HTML dashboard. Download `report.html` to view its interactive graphs.

The archive was copied from `loadtests/results/` with
`node loadtests/archive-results.mjs`. Only the HTML file's local script path was
sanitized; the measurements were unchanged.
