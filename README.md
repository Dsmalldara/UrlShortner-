# URL Shortener

A URL shortener built with Hono, TypeScript, and PostgreSQL. PostgreSQL generates
the numeric IDs, which are encoded as Base62 short codes. The project also includes
Vitest coverage and a k6 load-test runner.

- [Performance results](docs/performance-results.md)
- [Load-test guide](loadtests/README.md)
- [Saved benchmark reports](docs/reports/README.md)

## Run locally

Install a recent Node.js version, pnpm, and Docker Desktop, then run:

```sh
pnpm install
cp .env.example .env
pnpm db:up
pnpm dev
```

The API runs at `http://localhost:3000`. Docker creates the development and
load-test databases on first startup. Install k6 only when running load tests.

## Commands

```sh
pnpm test --run         # run tests
pnpm build              # compile TypeScript
pnpm load:prepare       # seed the load-test database
pnpm load:run           # run the default k6 workload
pnpm db:down            # stop PostgreSQL
```

Configuration lives in [`.env.example`](.env.example). Shell variables override
the file, for example:

```sh
PGPOOL_MAX=5 RATE=2000 DURATION=10m pnpm load:run
```

Tests use the configured `PGDATABASE` and insert rows.
