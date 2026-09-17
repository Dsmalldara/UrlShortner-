# Load tests

The runner starts a dedicated Hono server on `127.0.0.1:3001` and uses the
disposable `url_shortener_loadtest` database.

## Prepare

```sh
pnpm db:up
pnpm load:prepare
```

This applies the migration, seeds 100,000 fictional URLs, and writes their codes
to `loadtests/data/urls.json`. To delete previous load-test rows and reseed:

```sh
pnpm load:prepare --reset
```

The reset command only accepts database names ending in `_loadtest`.

## Run

```sh
pnpm load:run
```

Override the workload with shell variables:

```sh
RATE=2000 DURATION=10m WARMUP=60s \
PREALLOCATED_VUS=1000 MAX_VUS=1000 \
PGPOOL_MAX=5 pnpm load:run
```

`RATE` is the total request rate and must be divisible by four. k6 sends 25% of
it to creations and 75% to redirects. Creation URLs are unique; 80% of redirects
target the hottest 1% of seeded URLs. Redirect following is disabled.

Increase `RATE` gradually. If k6 reports insufficient VUs, raise the VU limits or
lower the rate. A dropped iteration was never sent to the API.

## Compare redirect statuses

Use the same starting data and settings for both runs:

```sh
pnpm load:prepare --reset
REDIRECT_STATUS=301 RATE=2000 DURATION=10m pnpm load:run

pnpm load:prepare --reset
REDIRECT_STATUS=302 RATE=2000 DURATION=10m pnpm load:run
```

## Output

Each run creates a timestamped directory under `loadtests/results/` containing:

- `report.html` — interactive k6 dashboard
- `summary.json` — request, check, threshold, and latency totals
- `metadata.json` — workload, machine, versions, row counts, and source hashes
- `resources.jsonl` — five-second application, k6, PostgreSQL, and host samples
- `server.log` — load-server output

Generated results are ignored by Git. Selected evidence is archived in
[`docs/reports`](../docs/reports/README.md).
