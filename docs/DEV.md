# Development

Helper commands for local work. There is no Makefile. Run them from the repository root.
You need Docker, uv, and pnpm.

## Start the database

```sh
docker compose up -d --wait
```

Postgres 16 listens on `127.0.0.1:5432`. User, password, and database are `sentinel`.
Data stays in the named volume `sentinel_pg`. Follow logs with `docker compose logs -f postgres`.
`docker compose down` stops the container. `docker compose down -v` deletes the volume.
Copy the API environment once, then set `TINYFISH_API_KEYS` and `EVIDENCE_SIGNING_SECRET`.
`DATABASE_URL` already points at this database.

```sh
cp .env.example .env
```

## Run the API

```sh
uv run --project apps/api api
```

Listens on `http://127.0.0.1:8000`. Settings load `.env` from the current directory, so stay at the repository root.

## Run the web app

```sh
cp apps/web/.env.example apps/web/.env.local
pnpm --dir apps/web install
pnpm --dir apps/web dev
```

Listens on `http://localhost:3000` and calls `NEXT_PUBLIC_API_BASE_URL`.

## Run all checks

API checks use the config in `apps/api`: ruff, format, mypy, pytest.

```sh
cd apps/api
uv run ruff check .
uv run ruff format --check .
uv run mypy
uv run pytest
```

Web checks are the npm scripts `lint`, `typecheck`, `test`, and `format`.

```sh
pnpm --dir apps/web lint
pnpm --dir apps/web typecheck
pnpm --dir apps/web test
pnpm --dir apps/web format
```
