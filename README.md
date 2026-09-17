```
pnpm install
cp .env.example .env
pnpm dev
```

```
open http://localhost:3000
```

The development, start, test, and load-test scripts load `.env` when it exists.
Use a Node.js version that supports `--env-file-if-exists`; the recorded
benchmarks used Node.js 25.9.0. Set your PostgreSQL connection details in `.env`;
see `.env.example` for the supported settings. Creating this file does not create
the database or apply the schema.

Values supplied by your shell override `.env`, for example:

```sh
PGPOOL_MAX=5 RATE=2000 DURATION=10m pnpm load:run
```

Tests use `PGDATABASE` and insert rows. To run them against a separate test
database, create it and apply `db/migrations/001_create_urls.sql` first, then use
`PGDATABASE=url_shortener_test pnpm test --run`.

See the [load-test setup](loadtests/README.md) and
[performance results](docs/performance-results.md) for the experiment details.
