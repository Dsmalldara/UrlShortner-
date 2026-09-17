# URL Shortener: From Design to Load Testing

I built this URL shortener to explore how a backend behaves under sustained load.
It started with an in-memory store, then moved to PostgreSQL, with Hono handling
HTTP requests and Base62 turning database IDs into short codes.

The design target was 100 million new URLs and 300 million redirects per day.
I translated that into requests per second and tested the implementation locally
with k6, measuring latency, failed requests, and how much scheduled traffic the
test could actually deliver.

**[Read the design and performance write-up →](docs/performance-results.md)**

The write-up follows the design decisions, workload calculations, and experiments,
including what happened as the local setup approached the target rate.

**[Explore the saved benchmark reports →](docs/reports/README.md)**

The selected reports include the test settings, raw summaries, resource samples,
and interactive graphs. All tests ran with the API, PostgreSQL, and k6 sharing
one 8 GB M1 Mac; the results describe that environment.

## Run locally

You'll need pnpm, Docker Desktop, and a Node.js version that supports
`--env-file-if-exists`. The recorded benchmarks used Node.js 25.9.0.

```sh
pnpm install
cp .env.example .env
```

Start PostgreSQL with Docker Compose:

```sh
pnpm db:up
pnpm dev
```

The first startup creates both `url_shortener` and `url_shortener_loadtest` and
applies the migration to each. The database data persists in the named
`postgres_data` volume. To remove that data and recreate both databases from
scratch, use `docker compose down -v`.

The server runs at `http://localhost:3000`.

## Configuration and tests

The development, start, test, and load-test scripts load `.env` when it exists.
See [`.env.example`](.env.example) for the supported settings.

Values supplied by your shell override `.env`, for example:

```sh
PGPOOL_MAX=5 RATE=2000 DURATION=10m pnpm load:run
```

Tests use `PGDATABASE` and insert rows. To run them against a separate test
database, create it and apply `db/migrations/001_create_urls.sql` first, then use
`PGDATABASE=url_shortener_test pnpm test --run`.

See the [load-test setup](loadtests/README.md) for seeding data and running the
benchmarks.
