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
npm test --prefix dashboard
npm run typecheck --prefix dashboard
npm run build --prefix dashboard
.venv/bin/python -m unittest discover -s tests -p test_worker.py
.venv/bin/python -m unittest discover -s tests -p test_demo_data.py
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

## CI and browser smoke test

[GitHub Actions](../.github/workflows/ci.yml) runs both JavaScript test suites,
typechecks, and builds, the worker unit suite, the seven PostgreSQL integration
tests, and a Chromium browser smoke test on every push and pull request. It uses
ephemeral PostgreSQL and Redis service containers. No AWS credentials, Floci,
homelab, or existing Cloud-Sentinel database is required.

The browser test starts the built gateway and dashboard, creates the owner,
seeds the [fictional demo reports](DEMO.md), then checks the overview trend,
report export, CIS controls, finding links, and potential attack path. Failure
screenshots, traces, and the Playwright report are uploaded by CI.

To run the browser test locally, provide a **dedicated, disposable** PostgreSQL
database named `cloud_sentinel_e2e` and Redis on localhost ports 5432 and 6379.
The configuration refuses to run unless `DATABASE_URL` and `E2E_DATABASE_URL`
match that dedicated database. After installing project dependencies:

```bash
export DATABASE_URL=postgresql://postgres:sentinel-test-only@127.0.0.1:5432/cloud_sentinel_e2e
export E2E_DATABASE_URL="$DATABASE_URL"
export E2E_PYTHON="$PWD/.venv/bin/python"
npm run build --prefix gateway
npm run build --prefix dashboard
npm exec --prefix dashboard -- playwright install --only-shell chromium
npm run test:e2e --prefix dashboard
```

Use a disposable database; the test reuses its test owner if run again. Playwright
starts and stops the local gateway and dashboard on ports 43100 and 43101; it does
not start PostgreSQL or Redis. The CI job creates those services automatically.
