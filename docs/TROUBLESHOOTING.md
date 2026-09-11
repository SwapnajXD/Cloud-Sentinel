# Troubleshooting

Run commands from the repository root with `infra/.env` configured. The base
stack uses service names `gateway`, `worker`, `dashboard`, `db`, `redis`, and
`nginx`; the default UI address is http://localhost:8080.

## Start with status and logs

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml ps
docker compose --env-file infra/.env -f infra/docker-compose.yml logs --tail=100 gateway worker
curl http://localhost:8080/ready
curl http://localhost:8080/health
```

`/ready` checks the gateway's migration-table access. `/health` also checks
Redis and a worker heartbeat within 90 seconds; 503 means degraded health.
The response's `checks` object identifies the affected dependency.

## NGINX unhealthy while the gateway is healthy

If NGINX's `/ready` probe returns 404 or 502 after rebuilding services, it may
have an old configuration or a stale upstream address. Compare the gateway
directly with the proxy:

```bash
curl -i http://127.0.0.1:3000/ready
curl -i http://127.0.0.1:8080/ready
```

The current NGINX configuration refreshes service addresses through Docker DNS.
Recreate NGINX to load it, including a fresh bind mount of the configuration:

```bash
sudo docker compose --env-file infra/.env -f infra/docker-compose.yml up -d --no-deps --force-recreate nginx
curl -i http://127.0.0.1:8080/ready
```

Allow up to 30 seconds for the next health check. If the response is still
unexpected, inspect the loaded configuration and recent errors:

```bash
sudo docker exec cloud-sentinel-nginx-1 nginx -T
sudo docker logs --tail=50 cloud-sentinel-nginx-1
```

## Forgotten owner password or registration closed

Registration closes when an owner exists, enforced by PostgreSQL. Setting
`SINGLE_USER_MODE=false` does not reopen it. To recover an existing account,
run this from a private terminal with the Compose gateway running:

```bash
python3 scripts/reset_owner_password.py owner@example.com
```

Use `--sudo` before the email if Docker requires it. The command asks for the
new password twice. It requires at least 12 characters and at most 72 UTF-8
bytes, and refuses prompts that would echo the password. If the owner-match
check fails, verify the existing email; the installation must have exactly one
matching owner. It does not create a missing account.

If the command cannot run, check Python 3, Docker access, `infra/.env`, and the
`gateway` service. The recovery command uses the running container; `dev.sh`
alone is insufficient. See [Owner password recovery](DEPLOYMENT.md#owner-password-recovery)
for full requirements and immediate session invalidation. Resetting a password
alone leaves existing JWTs valid until their one-hour expiry.

## Missing or expired AWS credentials

Verify the intended CLI profile:

```bash
aws sts get-caller-identity
```

Refresh exported credentials and recreate the stack through the launch script.
It runs `aws login` if the selected profile cannot export credentials:

```bash
./start.sh
```

Set `AWS_PROFILE=my-profile` for a named login profile. `docker compose restart
worker` does not reload credentials; rerun `./start.sh` instead. Workload IAM
roles can supply credentials without `.aws.env`; use `--skip-aws-refresh` to
skip local export.

For an AssumeRole failure, verify the selected role, trusted worker principal,
matching External ID, and worker permission to assume that role. A saved
connection is not proof that AWS access works. Disconnected connections cannot
be used for new scans and do not fall back to another account.

## Partial reports or unknown checks

Open the report and inspect unknown findings, service coverage, scope, and
error codes. Partial results preserve observed findings when other evidence
cannot be obtained; they are not evidence of a clean account. Verify scan-role
permissions and service availability, then run a new scan.

The bundled role policy is missing some newer S3 and IAM read permissions;
see [Scan-role permissions](AWS.md#scan-role-permissions). An empty inventory
can yield skipped checks. A null score means no pass/fail checks were observed.

## Queued jobs or interrupted scans

Inspect worker logs and database tasks:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml logs --tail=100 worker
docker compose --env-file infra/.env -f infra/docker-compose.yml exec db psql -U postgres -d cloud_sentinel
```

```sql
SELECT task_id, status, attempts, progress, available_at, lease_until, error
FROM audit_tasks ORDER BY created_at DESC LIMIT 20;
SELECT worker_id, updated_at FROM worker_heartbeats;
```

PostgreSQL is the durable queue. Jobs waiting to retry remain `queued` until
`available_at`; a crashed worker's running job becomes recoverable after lease
expiry. Check worker/database availability rather than manipulating Redis lists.
Exhausted jobs appear in **Scans** and `/api/dead-letter`; dismissal retains
history and does not rerun a job. Start a new scan after correcting its cause.

## Redis is unavailable

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml logs --tail=100 redis
docker compose --env-file infra/.env -f infra/docker-compose.yml restart redis
```

Redis supplies wakeups; queued jobs remain in PostgreSQL and workers poll for
them. Redis failure degrades `/health`. Compose initially waits for healthy
Redis before starting the gateway, even though ongoing worker processing can
continue without Redis after startup.

## Gateway or database startup failures

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml logs --tail=100 gateway db
```

Check required `JWT_SECRET` and `POSTGRES_PASSWORD`, database connectivity,
and occupied ports. JWT secrets must contain at least 32 characters and must
not start with `change-me`.

Both backend processes apply shared migrations. Legacy multiple-owner or
invalid foreign-key data can block migration; inspect and back up the database
before correcting it. See [Database](DATABASE.md). Do not remove volumes to
resolve a recoverable migration or password issue.

Changing `POSTGRES_PASSWORD` in the environment does not update an existing
database role's password. Keep the database role and application connection
settings consistent when rotating it.

## Dashboard and local development

Use http://localhost:8080 for NGINX or http://localhost:3001 for local development.
For a proxy error such as `Gateway unavailable`, inspect gateway availability
and dashboard `BACKEND_URL`:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml logs --tail=100 dashboard nginx
```

`dev.sh` requires both Node dependency directories, `.venv`, and `infra/.env`.
Start `db` and `redis` with the development Compose override first. Stop
containerized application services before starting local processes on ports
3000/3001. See [Local development](DEPLOYMENT.md#local-development).

For 401 responses after a session has been active for an hour, sign in again.
For CORS failures on direct cross-origin requests, check `ALLOWED_ORIGIN`.
For rate-limit responses, wait for the indicated reset before retrying.

## Optional AI errors

Inspect the gateway's `GEMINI_API_KEY` and `GEMINI_MODEL` configuration. Missing
configuration returns 503; provider failures and timeouts return 502. Recreate
the gateway after changing Compose environment values. Scanner reports remain
available independently of optional interpretation.
