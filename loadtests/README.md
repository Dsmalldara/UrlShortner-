# Local load tests

These commands use `url_shortener_loadtest` and start their own Hono server on
`127.0.0.1:3001`. Your usual dev server can stay on port 3000. Your existing store
functions, SQL queries, indexes, and connection pool are used by the load server.
Only the load-test tools connect to the disposable database; this does not change
which database your existing Vitest tests use.

## Prepare once

```sh
pnpm load:prepare
```

Creates the load-test database if needed, applies your existing migration if the
URLs table does not exist, and seeds 100,000 URLs. Saves their short codes and long
URLs to `loadtests/data/urls.json`. Seed URLs are roughly 100–340 characters long
and include query parameters. Their destinations are fictional `.test` domains.
Requests never follow those destinations.

Preparation is repeatable and preserves previous test writes. For a fresh starting
dataset, explicitly reset **only the load-test database**:

```sh
pnpm load:prepare --reset
# Larger starting dataset:
SEED_COUNT=1000000 pnpm load:prepare --reset
```

`--reset` removes all URLs in this disposable database and restarts its identity.
Database names must end in `_loadtest`; the tools ignore PGDATABASE in favour of
their own LOADTEST_DATABASE setting. PGHOST, PGPORT, PGUSER, and PGPASSWORD retain
their usual meanings. No password is required if your local Postgres allows it.

## First mixed run

```sh
pnpm load:run
```

Builds your app, starts the load server, checks a known redirect, ramps for 10
seconds, then holds 40 requests/second for 30 seconds. Finally shuts down its own
server and saves the results. This is a setup check, not a three-hour soak.

The two request-rate scenarios preserve a 25% creation / 75% redirect split.
Every creation uses a new URL, so its expected status is 201. The redirect scenario
expects 301 and the exact stored Location. By default, 80% of redirects request the
hottest 1% of seeded keys; the rest request the remaining keys uniformly. These are
explicit modelling assumptions, not claims about real production traffic.

Redirects are not followed. Browser and CDN cache effects are not simulated.
Hot keys model repeated DB accesses; there is no application cache in this version.

## Calibrate before soaking

```sh
RATE=40 DURATION=2m WARMUP=30s pnpm load:run
RATE=80 DURATION=2m WARMUP=30s pnpm load:run
RATE=160 DURATION=2m WARMUP=30s pnpm load:run
```

RATE is aggregate requests per second and must be a multiple of four. Increase it
gradually, reviewing latency, dropped iterations, errors, CPU, and memory. Do not
assume these example rates are your machine's capacity. Set PREALLOCATED_VUS and
MAX_VUS (per scenario) if k6 cannot schedule the offered traffic; keep an eye on
k6's own CPU/memory because it shares the machine with the app and Postgres.

Checks must pass at least 99.9% of the time per operation, HTTP failures must stay
below 1%, and no scheduled iterations may be dropped. Failed thresholds return a
nonzero exit code. Percentiles are recorded even without a latency budget; set
P95_MS after you choose a budget to make p95 a pass/fail condition as well.

## Trial, then soak

Choose a rate around 60–70% of the sustainable rate observed during calibration:

```sh
# Example rate only: replace 40 with your measured choice.
RATE=40 DURATION=30m WARMUP=30s pnpm load:run
RATE=40 DURATION=3h WARMUP=30s pnpm load:run
```

Writes remain in the load-test database. At 40 requests/second, the three-hour
hold creates about 108,000 new rows, plus warmup writes.

## Compare 301 and 302

Reset and reseed before each run so each has the same starting dataset. Use the
same workload settings and machine conditions. Repeat pairs with the order reversed
to reduce bias from cache warming and background activity. Resetting the data does
not reproduce a cold Postgres/OS cache; these are warmed local comparisons.

```sh
pnpm load:prepare --reset
REDIRECT_STATUS=301 RATE=40 DURATION=30m WARMUP=30s pnpm load:run

pnpm load:prepare --reset
REDIRECT_STATUS=302 RATE=40 DURATION=30m WARMUP=30s pnpm load:run
```

Normal app startup still defaults to 301. The load server chooses the status through
the optional argument to createHono; no database code is swapped out.

## Results

Each run saves its own timestamped directory under `loadtests/results/`:

- `report.html`: standalone k6 dashboard with throughput, latency, and error graphs.
- `summary.json`: aggregate metrics, checks, thresholds, and p50 (`med`), p95, p99
  separately for creation and redirect latency. Whole-run percentiles include warmup.
- `resources.jsonl`: five-second samples of app/k6 CPU and RSS, local PostgreSQL
  process totals, host load/free memory, DB connections, size, and I/O counters.
- `metadata.json`: workload, versions, machine, initial/final row counts, source
  hashes, and run outcome.
- `server.log`: output and errors from the dedicated load server.

Open report.html in a browser. PostgreSQL process RSS totals include shared memory
and must not be treated as unique physical memory usage. Database counters are
cumulative: compare sample deltas. They measure DB activity rather than OS disk
throughput. The monitoring tool adds one Postgres connection. The dashboard shows
time-window percentiles; summary.json contains percentiles for the whole run.
Keep this distinction when comparing results.

Generated data and reports are ignored by Git. Your hand-written smoke.js is kept.

References: [k6 arrival-rate executors](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/ramping-arrival-rate/),
[dashboard reports](https://grafana.com/docs/k6/latest/results-output/web-dashboard/),
and [custom summaries](https://grafana.com/docs/k6/latest/results-output/end-of-test/custom-summary/).
