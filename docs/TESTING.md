# Testing

Run commands from the repository root. Local JavaScript development uses Node
22–26; Docker builds use Node 22. Worker tests require Python 3.11 or newer.

## Install dependencies

```bash
npm ci --prefix gateway
npm ci --prefix dashboard
python3 -m venv .venv
.venv/bin/python -m pip install -r worker/requirements.txt
```

## Unit tests and builds

```bash
npm test --prefix gateway
npm run typecheck --prefix gateway
npm run build --prefix gateway
npm run typecheck --prefix dashboard
npm run build --prefix dashboard
.venv/bin/python -m unittest discover -s tests -p test_worker.py
python3 -m unittest discover -s tests -p test_password_reset.py
```

Gateway tests mock PostgreSQL, Redis, and the AI provider. Supertest opens a
temporary local HTTP socket, so these tests need an environment that allows
local socket binding. Worker unit tests mock AWS and database calls; they
require no credentials or running services. Password-recovery tests use only
the Python standard library and mock terminal prompts and Docker execution;
they verify private stdin transfer, sudo handling, and invalid-input rejection
without changing an owner password or contacting a database.

## PostgreSQL integration tests

`tests/test_database.py` tests actual migrations, the single-owner constraint,
concurrent claims, expired leases, report transactions, recurring schedules,
and owner deletion. It creates a randomly named scratch database and removes
it on completion. Without `TEST_DATABASE_URL`, these tests are skipped.

The following uses an existing worker image for its Python dependencies and
mounts the current checkout so it tests the source being edited. Build that
image first if it is not present:

```bash
docker build -f worker/Dockerfile -t cloud-sentinel-worker:latest .
```

Run the checks against a temporary PostgreSQL container. Use `sudo docker` if
your Docker installation requires it. No host database port or persistent
volume is created.

```bash
docker run -d --rm --name cloud-sentinel-db-check \
  -e POSTGRES_PASSWORD=sentinel-test-only postgres:15-alpine

docker run --rm --network container:cloud-sentinel-db-check \
  -v "$PWD:/workspace:ro" -w /workspace \
  -e TEST_DATABASE_URL=postgresql://postgres:sentinel-test-only@127.0.0.1:5432/postgres \
  -e MIGRATIONS_DIR=/workspace/gateway/migrations \
  --entrypoint python cloud-sentinel-worker:latest tests/test_database.py

docker stop cloud-sentinel-db-check
```

Stop the temporary database container after the test command, including when a
test fails. These checks validate PostgreSQL behavior; they do not exercise live
AWS, browser interactions, or the full running Compose stack.
