# Building and Load Testing a URL Shortener on an M1 Mac

This project began with an in-memory URL store, moved to PostgreSQL, and then used local load tests to explore how the implementation behaved as traffic increased. The purpose was to connect system-design estimates to measurements of an actual backend.

At an offered rate of 2,000 requests per second, a ten-minute test completed with zero HTTP failures and zero dropped iterations. At 4,632 requests per second, the system completed approximately 2.89 million requests with all response checks passing, but k6 dropped 1.505% of scheduled iterations and tail latency rose sharply. These results describe the combined local test environment; they do not establish production capacity or isolate the bottleneck.

## Design target and maths

Before building, I wanted a traffic target to design around. I chose 100 million new short URLs and 300 million redirects per day. Creating a short URL means writing to the database, while following one means reading the stored destination. That gives us one write for every three reads: a 25% write and 75% read split.

Those daily numbers sound large, so I converted them into requests per second. There are 86,400 seconds in a day:

```text
100,000,000 ÷ 86,400 ≈ 1,157 writes per second
300,000,000 ÷ 86,400 ≈ 3,472 reads per second
Total: about 4,630 requests per second
```

This gave me something concrete to test on my laptop. For the final run, I rounded the target to 4,632 requests per second: 1,158 writes and 3,474 reads. That kept the 25/75 split exact. These numbers represent average daily traffic; real traffic would have quieter periods and peaks. The ten-minute test would show how the local setup handled that request rate for that period.

Next, I wanted to know whether seven characters would be enough for the short code. Base62 uses the digits `0–9`, lowercase letters `a–z`, and uppercase letters `A–Z`, giving us 62 choices for each character. Seven positions give us:

```text
62^7 = 3,521,614,606,208 combinations — about 3.52 trillion
```

At 100 million new URLs every day, ten years would produce roughly 365 billion URLs. So seven characters give us plenty of room for the planned number of URLs.

To generate the codes, I used the unique numeric ID PostgreSQL assigns to each row and converted it to Base62. For example, with my alphabet, ID `62` becomes `10`. Different IDs produce different codes, so this avoids generating random codes and checking whether they collide.

When someone follows a short URL, the application converts the code back into its numeric ID and uses that ID to look up the original URL in PostgreSQL. Base62 represents the ID; the destination URL still lives in the database.

There is one limit to keep in mind: the code stays within seven characters only while the ID is below `62^7`. PostgreSQL's ID sequence can skip numbers, so the highest ID is not necessarily the number of stored URLs. The calculation shows that the planned count fits, but the current schema does not enforce a seven-character limit.

## How the application works

I kept the database structure simple: one [`urls` table](../db/migrations/001_create_urls.sql) containing the original URL, an automatically generated numeric ID, and the time the row was created. The ID is the primary key, and the original URL has a unique constraint so the database cannot store the same URL twice.

When someone submits a URL to `/shorten`, the application first checks whether the normal url is  already stored. If it is, it returns the short code for the existing ID. Otherwise, it saves the URL, converts the new ID to Base62, and returns the code with HTTP 201, meaning a new resource was created. So creating a short URL involves two database queries: a lookup followed by an insert.

When someone requests `/expand` with a short code, the application converts it back to an ID and looks up the original URL. It then returns a 301 redirect, with the destination in the response's `Location` header. That tells the browser where to go next. Every redirect in these tests required a database lookup because I had not added an application cache.

The [Hono routes](../src/routes/url.ts) call the SQL functions in [store.ts](../src/store/store.ts). Those functions use a shared [connection pool](../src/db.ts), which lets requests reuse database connections instead of opening a new connection for every query. The pool size controls how many connections the application can use at once; requests wait when all of them are busy.

For the load tests, every creation request submitted a new URL, so it went through both the lookup and insert. Redirect requests used URLs I had put into the database before the test started. This let me test creation and redirection independently: the write workload kept adding rows, while the read workload kept looking up an existing set of URLs.

## Test environment and workload

All selected runs used an Apple M1 with eight logical CPUs and 8 GiB of memory. Hono, PostgreSQL, and k6 ran on the same machine, with HTTP requests sent over loopback to port 3001. Recorded versions were Node.js v25.9.0, PostgreSQL 17.11, and k6 v2.2.0. The selected runs have matching source hashes for the files recorded in their metadata.

The [runner](../loadtests/run.mjs) builds the application, starts a dedicated server against `url_shortener_loadtest`, runs k6, samples resources, and saves reports. The [preparation script](../loadtests/prepare.mjs) seeds fictional `.test` URLs directly into PostgreSQL. The regular development database is separate.

The [load script](../loadtests/soak.js) runs independent arrival-rate scenarios for creations and redirects. It ramps from roughly 10% of the target over 60 seconds, then holds the configured rate. This is a ramp-and-hold workload, not an explicit burst-traffic model. Each scenario iteration sends one HTTP request.

The redirect set contains 100,000 URLs. By default, 80% of redirects select the hottest 1% of that set, while the remaining 20% select from the other keys. Creation URLs include a run identifier, iteration identifier, and variable query-string padding. Requests have a five-second timeout. Redirect following is disabled, so no destination website is contacted.

## Ten-minute capacity results

All three runs below used an application pool maximum of five connections, a 60-second ramp, a ten-minute hold, and HTTP 301 redirects. There were zero HTTP failures and all configured response checks passed in each run.

| Offered total RPS | Write / read RPS | HTTP requests completed | Dropped iterations | Creation p95 / p99 (ms) | Redirect p95 / p99 (ms) |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 2,000 | 500 / 1,500 | 1,265,929 | 0 (0%) | 2.42 / 63.18 | 0.98 / 39.97 |
| 3,240 | 810 / 2,430 | 2,047,087 | 3,710 (0.181%) | 14.63 / 342.64 | 7.41 / 155.65 |
| 4,632 | 1,158 / 3,474 | 2,887,786 | 44,122 (1.505%) | 759.97 / 1,456.79 | 344.10 / 699.64 |

The runs also differed in starting table size and, for the final run, the available VUs:

| Offered RPS | Initial rows | Final rows | Maximum VUs per scenario | Highest sampled total VUs | k6 exit code |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 2,000 | 274,054 | 590,536 | 1,000 | 471 | 0 |
| 3,240 | 100,000 | 612,353 | 1,000 | 1,904 | 99 |
| 4,632 | 100,000 | 828,414 | 1,500 | 3,000 | 99 |

Each scenario preallocated 1,000 VUs. The maxima apply separately to creations and redirects, giving a total ceiling of 2,000 or 3,000 VUs. Although the console reported 100,000 seeded targets for every run, this did not mean every database contained only 100,000 rows. The initial row counts above come from `metadata.json`.

These are individual observations, not repeated trials with confidence intervals. They show how the tested configurations behaved, but they are not a comparison where only request rate changed.

## Reading the measurements

The reported counts and percentiles include warmup. HTTP request counts also include one preflight redirect outside the scenario iterations. Drop percentages use:

```text
dropped_iterations / (completed_iterations + dropped_iterations) × 100
```

All selected runs finished their started iterations. A dropped iteration was scheduled work that k6 could not start with an available VU; it never became an HTTP request. It is separate from a request that was sent and then failed or timed out. A backend slowdown can keep VUs busy and lead to drops, but drops alone do not identify the component causing the slowdown.

Creation checks verify HTTP 201 and a one-to-seven-character alphanumeric code. Redirect checks verify HTTP 301 and the exact expected `Location`. Passing these checks does not establish every property of correctness: for example, this load script does not expand each newly created code or test concurrent duplicate submissions.

The latency metrics record `response.timings.duration`. They describe HTTP request duration as measured by k6, not just SQL execution time or the entire user journey. A p95 of 759.97 ms means approximately 95% of measured creation durations were at or below that value. Whole-run percentiles are computed from the run's samples; they are not averages of the dashboard's five-second-window percentiles.

The configured thresholds require at least 99.9% check success per operation, less than 1% HTTP failures, and exactly zero dropped iterations. No p95 latency budget was configured. Both higher-rate tests returned exit code 99 solely because the zero-drop threshold failed. Their passing HTTP checks and failing delivery threshold should both be reported.

## Separate thirty-minute endurance observation

A longer run used pool 20 at 1,100 total requests per second, with the same 60-second warmup and a thirty-minute hold. It started with 100,000 rows and ended with 604,049.

| HTTP requests completed | HTTP failures | Check success | Dropped iterations | Creation p95 / p99 (ms) | Redirect p95 / p99 (ms) |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 2,016,087 | 0 | 100% | 111 (0.0055%) | 2.94 / 50.31 | 1.20 / 26.55 |

This run also returned exit code 99 because of the zero-drop threshold. It provides longer-duration evidence at a lower load. A three-hour soak was discussed but is not demonstrated by these results.

## Findings and limits

Five application connections were sufficient for the 2,000-RPS ten-minute run under the measured conditions.

Earlier  runs included severe slowdowns, timeouts, changing pool and VU settings, and different database sizes. Later runs performed much better after reducing background activity, chrome was hitting up a huge chunk of my memory, this definately contributed to the slow downs.  



The dataset remained below one million rows in the selected runs. Reads concentrated on a fixed seeded set, while the table grew through writes. Resetting rows does not guarantee cold database or operating-system caches. These tests do not reproduce years of storage growth, distributed traffic, replication, failover, backups, or internet latency. All selected runs used 301 redirects; they do not compare 301 with 302 or measure browser/CDN caching effects, although I would probably do that some other time to compare latency.

The supported conclusion is that this implementation processed millions of local requests with the tested response checks passing, while increased offered load exposed latency growth and a measurable delivery shortfall, but all this is fairly minimal to not affect as much. Establishing the cause would require separate load-generation resources and more targeted measurements, which I would probably do some other time. 

## Reproducing the workload

The following commands reset only the disposable load-test database and configure the final offered workload. Keep the laptop plugged in with its lid open and keep background activity consistent.

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

For the 3,240-RPS configuration, use `RATE=3240` and `MAX_VUS=1000`. The 2,000-RPS run used those same VU settings but retained previous writes; resetting to 100,000 rows would produce a new baseline rather than exactly recreate its starting data. Full tooling instructions are in [loadtests/README.md](../loadtests/README.md).

## Saved evidence

Values in this document were checked against the saved `summary.json` and `metadata.json` files. Run directory names use UTC timestamps. The four selected runs are included in [docs/reports](reports/README.md), with their summaries, metadata, resource samples, and interactive reports. The HTML copies omit the original absolute script path; measurements are unchanged. Download a report and open it in a browser to use its interactive graphs.

| Run | Summary | Metadata | Resource samples | Interactive report |
| --- | --- | --- | --- | --- |
| Pool 5, 2,000 RPS, 10 min | [Summary](reports/2026-09-16T18-50-35-538Z-fea50fea-301/summary.json) | [Metadata](reports/2026-09-16T18-50-35-538Z-fea50fea-301/metadata.json) | [Resources](reports/2026-09-16T18-50-35-538Z-fea50fea-301/resources.jsonl) | [Report](reports/2026-09-16T18-50-35-538Z-fea50fea-301/report.html) |
| Pool 5, 3,240 RPS, 10 min | [Summary](reports/2026-09-16T23-16-39-759Z-faef85bc-301/summary.json) | [Metadata](reports/2026-09-16T23-16-39-759Z-faef85bc-301/metadata.json) | [Resources](reports/2026-09-16T23-16-39-759Z-faef85bc-301/resources.jsonl) | [Report](reports/2026-09-16T23-16-39-759Z-faef85bc-301/report.html) |
| Pool 5, 4,632 RPS, 10 min | [Summary](reports/2026-09-16T23-31-04-717Z-1bfdfc02-301/summary.json) | [Metadata](reports/2026-09-16T23-31-04-717Z-1bfdfc02-301/metadata.json) | [Resources](reports/2026-09-16T23-31-04-717Z-1bfdfc02-301/resources.jsonl) | [Report](reports/2026-09-16T23-31-04-717Z-1bfdfc02-301/report.html) |
| Pool 20, 1,100 RPS, 30 min | [Summary](reports/2026-09-16T17-51-55-633Z-57ff6a54-301/summary.json) | [Metadata](reports/2026-09-16T17-51-55-633Z-57ff6a54-301/metadata.json) | [Resources](reports/2026-09-16T17-51-55-633Z-57ff6a54-301/resources.jsonl) | [Report](reports/2026-09-16T17-51-55-633Z-57ff6a54-301/report.html) |
