# Deployment guide

Run commands from the repository root. Container deployment requires Docker
with Compose v2 supporting optional `env_file` entries. Local development
uses Node.js 22–26 and Python 3.11 or newer; container builds use Node 22.
Use the AWS CLI when exporting local credentials.

## Configure the environment

```bash
cp infra/.env.example infra/.env
openssl rand -hex 32
openssl rand -hex 32
```

Set `JWT_SECRET` and `POSTGRES_PASSWORD` in `infra/.env` to separate generated
values. Keep populated environment files private. Because `dev.sh` sources
`infra/.env` in Bash, use shell-compatible assignments when developing locally.

| Variable | Purpose / default |
| --- | --- |
| `JWT_SECRET` | Required; at least 32 characters, with no `change-me` prefix |
| `POSTGRES_PASSWORD` | Required database password; Compose supplies it to PostgreSQL and both backend processes |
| `AWS_REGION` | Default scan region, `us-east-1` |
| `BIND_ADDRESS`, `HTTP_PORT` | NGINX host binding, `127.0.0.1:8080` |
| `ALLOWED_ORIGIN` | Comma-separated browser origins; empty blocks cross-origin access in production and allows it in development |
| `FLOCI_ENDPOINT` | Optional AWS-compatible emulator endpoint, configured on gateway and worker |
| `MAX_TASK_RETRIES` | Retries after the first attempt, default `3` |
| `TASK_RETRY_DELAY_SECONDS` | Initial retry delay, default `5`; exponential backoff caps at 300 seconds |
| `JOB_LEASE_SECONDS` | Worker lease duration, default `120`, minimum `30` |
| `SCHEDULER_POLL_SECONDS` | Schedule polling setting, default `30` |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Optional gateway AI configuration; model defaults to `gemini-2.5-flash` |
| `CFN_TEMPLATE_URL`, `TRUSTED_PRINCIPAL_ARN` | Optional runtime settings for guided AWS connection setup |

Compose supplies `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD`
for database access, plus `REDIS_URL`. Outside Compose, the backend processes
also accept `DATABASE_URL`. The dashboard uses `BACKEND_URL` for its server-side
API proxy. Compose sets `TRUST_PROXY=true` on the gateway behind NGINX.

The app is always single-owner. `SINGLE_USER_MODE=false` has no effect and
cannot enable multiple users.

## Start the container stack

With an AWS CLI v2 console login profile:

```bash
aws login
./start.sh
```

Every start exports to the ignored `.aws.env` file using private permissions,
then starts Compose with a build. If export fails, the script runs `aws login`
and retries. Use `AWS_PROFILE=my-profile ./start.sh` for a named profile. The
legacy `--refresh-aws` flag still works. Repeat when temporary credentials
expire: exported container credentials do not refresh automatically. If using
an existing credential file or a workload IAM role, start with:

```bash
./start.sh --skip-aws-refresh
```

The worker loads `.aws.env` when present; it can otherwise use boto3's normal
credential chain. Floci clients use dummy credentials. See [AWS](AWS.md).

Open **http://localhost:8080**. NGINX routes API traffic to the gateway and
pages to the dashboard. Direct dashboard and gateway ports bind to loopback
at 3001 and 3000 respectively. PostgreSQL and Redis have no published host
ports in the base stack.

Services are `dashboard`, `gateway`, `worker`, `redis`, `db`, and `nginx`.
PostgreSQL and Redis use named volumes. The gateway and worker apply shared
SQL migrations at startup; see [Database](DATABASE.md) before upgrading a
legacy installation.

## Local development

Install service dependencies:

```bash
npm ci --prefix gateway
npm ci --prefix dashboard
python3 -m venv .venv
.venv/bin/python -m pip install -r worker/requirements.txt
```

If the full container stack is running, stop its application services to
free local ports and avoid running an extra worker:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml \
  stop nginx dashboard gateway worker
```

Start database and Redis with loopback host ports, then launch local processes:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml \
  -f infra/compose.dev.yml up -d db redis
./dev.sh
```

`dev.sh` reads `infra/.env` and an existing `.aws.env`, sets local connection
variables, and starts the gateway, worker, and Next.js development server.
It does not start database containers or refresh AWS credentials. To export
an authenticated profile without starting the full stack:

```bash
(umask 077; aws configure export-credentials --format env > .aws.env.tmp && mv .aws.env.tmp .aws.env)
```

Open **http://localhost:3001**; the dashboard forwards `/api/*` to the gateway
on port 3000. Ctrl+C stops the child processes; dependency containers remain.
See [Testing](TESTING.md) for unit tests, type checks, builds, and database tests.

## Owner password recovery

On a running Compose installation, use a private interactive terminal:

```bash
python3 scripts/reset_owner_password.py owner@example.com
```

If Docker requires sudo:

```bash
python3 scripts/reset_owner_password.py --sudo owner@example.com
```

The command requires Python 3, Docker Compose, `infra/.env`, and the running
`gateway` container with database access. It uses the gateway's Node.js
and database dependencies; no local Python packages are required. Local
`dev.sh` processes alone do not provide the container this command needs.

Enter the new password twice when prompted: at least 12 characters and at
most 72 UTF-8 bytes. Input must be private; the command refuses a terminal
that would echo the password. The password travels over the container command's
stdin, not a command-line argument. With `--sudo`, sudo authenticates first.

The script lowercases and trims the supplied email, locks existing owner rows,
and requires exactly one owner matching that email. It updates the bcrypt hash
in a transaction without changing owner identity, reports, or other workspace
data. Mismatched prompts or invalid passwords are rejected before a database
update. This is a host administration command, not a public recovery endpoint.

A password reset **does not revoke existing JWTs**. Existing sessions remain
valid until their one-hour expiry. If immediate session invalidation is needed,
rotate `JWT_SECRET` in `infra/.env` and recreate the gateway:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml \
  up -d --no-deps --force-recreate gateway
```

## Operations

Use explicit Compose paths from the repository root:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml ps
docker compose --env-file infra/.env -f infra/docker-compose.yml logs -f gateway worker
curl http://localhost:8080/ready
curl http://localhost:8080/health
```

Rebuild or scale:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml up -d --build
docker compose --env-file infra/.env -f infra/docker-compose.yml up -d --scale worker=3
```

Database row locks coordinate worker claims and schedule dispatch. Health
checks cover gateway readiness, dashboard availability, dependencies, and
worker heartbeat freshness. A degraded Redis check does not erase durable jobs.

Stop the base stack while preserving data:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml down
```

For development dependencies, include `-f infra/compose.dev.yml` in the same
command. Adding `-v` removes named volumes, including the database; use it
only when intentionally discarding installation data.

The default deployment is HTTP on loopback. For access beyond your machine,
configure TLS and network access controls, keep secrets private, and back up
PostgreSQL. A new `POSTGRES_PASSWORD` environment value does not change the
password already stored in an initialized PostgreSQL volume.
