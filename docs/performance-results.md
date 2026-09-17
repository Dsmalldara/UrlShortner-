# URL Shortener Performance Results

I built this project to connect a system-design target to a working backend and
measure how it behaved under load. The tests ran locally with the API, PostgreSQL,
and k6 sharing one 8 GB Apple M1.

## Design target

The target was 100 million creations and 300 million redirects per day:

```text
Writes: 100,000,000 / 86,400 = 1,157 requests/s
Reads:  300,000,000 / 86,400 = 3,472 requests/s
Total:                            4,630 requests/s
```

This gives a 25% write / 75% read workload. These are daily averages, not peak
traffic estimates.

Seven Base62 characters provide `62^7`, or 3.52 trillion, possible values. At
100 million new URLs per day, ten years would create about 365 billion URLs.
PostgreSQL supplies a unique numeric ID and the application encodes it as Base62.
The seven-character bound holds while the ID remains below `62^7`; the schema
does not currently enforce that limit.

## How it works

PostgreSQL stores each unique URL with an automatically generated ID.
`POST /shorten` returns the existing code or inserts the URL and encodes its ID.
`/expand` decodes the code, finds the URL by ID, and returns a `301` redirect.
There is no cache, so every redirect queries PostgreSQL.

## Workload

The k6 workload used separate creation and redirect scenarios. Creations always
used new URLs. Redirects read from 100,000 seeded URLs, with 80% of requests aimed
at the hottest 1%. Each run ramped for 60 seconds before holding its target rate.
Redirects were not followed.

Selected runs used Node.js 25.9.0, PostgreSQL 17.11, k6 2.2.0, and five application
database connections.

## Results

All delivered requests passed their response checks, and no HTTP requests failed.

| Offered RPS | Write / read RPS | Completed requests | Dropped iterations | Create p95 / p99 | Redirect p95 / p99 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 2,000 | 500 / 1,500 | 1,265,929 | 0 | 2.42 / 63.18 ms | 0.98 / 39.97 ms |
| 3,240 | 810 / 2,430 | 2,047,087 | 3,710 (0.181%) | 14.63 / 342.64 ms | 7.41 / 155.65 ms |
| 4,632 | 1,158 / 3,474 | 2,887,786 | 44,122 (1.505%) | 759.97 / 1,456.79 ms | 344.10 / 699.64 ms |

At 2,000 RPS, k6 delivered the full workload with low p95 latency. At 4,632 RPS,
checks still passed, but tail latency rose sharply and k6 could not start 1.505%
of the scheduled iterations.

A separate 30-minute run at 1,100 RPS used 20 database connections. It completed
2,016,087 requests with 111 dropped iterations, 2.94 ms creation p95, and 1.20 ms
redirect p95.

## Reading the numbers

- A dropped iteration never became an HTTP request because k6 had no available VU.
- A failed request was sent but returned an unexpected result or transport error.
- p95 is the duration at or below which 95% of measured requests completed.
- Percentiles and counts include the warmup period.
- Exit code `99` means a k6 threshold failed. The higher-rate runs failed the
  zero-dropped-iterations threshold.

## Limits

These are single local runs, not production capacity measurements. The load
generator, API, and database competed for the same CPU and memory. The dataset
stayed below one million rows, caches were warm, and the tests did not include a
CDN, multiple servers, replicas, internet latency, or 302 redirects.

The useful result is the shape of the slowdown: the implementation stayed stable
at 2,000 RPS, then latency and scheduling pressure increased as it approached the
4,630 RPS design target. The tests do not isolate which component caused it.

## Reproduce the final workload

```sh
pnpm load:prepare --reset

caffeinate -di env \
PGPOOL_MAX=5 \
PREALLOCATED_VUS=1000 \
MAX_VUS=1500 \
RATE=4632 \
DURATION=10m \
WARMUP=60s \
pnpm load:run
```

See the [load-test guide](../loadtests/README.md) for other settings. The selected
summaries, metadata, resource samples, and HTML dashboards are saved in
[docs/reports](reports/README.md).
