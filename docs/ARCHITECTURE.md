# System architecture

Cloud-Sentinel separates HTTP requests from AWS scan execution. PostgreSQL
stores both work and results; Redis supplies optional wakeups.

```text
Browser → NGINX ─→ Next.js console
               └→ Express gateway ─→ PostgreSQL
                                  └→ Redis audit_tasks notifications
Python worker ─→ PostgreSQL (claims, leases, reports, schedules, heartbeats)
              ─→ Redis (wait for wakeup when no job is ready)
              ─→ AWS APIs or configured Floci endpoint
```

NGINX routes `/api/`, `/health`, and `/ready` to the gateway and other paths
to the dashboard. During local development, the dashboard's `/api/*` route
forwards requests to `BACKEND_URL` with the bearer token. The browser does
not contact the database or AWS directly.

## Durable execution

`POST /api/audit` validates the selected connection, region, mode, and services
and inserts an `audit_tasks` row before responding with HTTP 202. A Redis
`audit_tasks` notification is best-effort; losing it does not lose the job.

Workers poll PostgreSQL and atomically claim due jobs using `FOR UPDATE SKIP
LOCKED`. Each claim increments `attempts` and assigns a lease token and expiry.
The default lease is 120 seconds (`JOB_LEASE_SECONDS`, minimum 30), renewed
in the background every third of the lease interval and at service progress
updates. Multiple workers can claim different jobs concurrently.

Completion locks and validates the unexpired lease, writes the report, and
updates the task in one transaction. A unique report `task_id` prevents
multiple persisted reports for a job. A worker that has lost its lease cannot
publish over a newer claim. AWS reads may repeat after interrupted execution.

The lifecycle is:

```text
queued → running → done
                 → partial (report contains unknown checks)
                 → queued (retry after a task-level failure)
                 → error (retry budget exhausted)
```

Expired running leases are recovered on subsequent claim attempts. Failures
retry up to `MAX_TASK_RETRIES` times after the first attempt (default 3).
Delay is `TASK_RETRY_DELAY_SECONDS * 2 ** (attempts - 1)`, capped at 300 seconds;
the default initial delay is 5 seconds.

Failed jobs are database rows with `status = 'error'`. The dead-letter API
lists undismissed failures; dismissal sets `dismissed = true` and retains
history. There is no authoritative Redis dead-letter queue.

## Scheduling and health

Each worker's maintenance loop checks due enabled schedules using row locks
with `SKIP LOCKED`. Job creation and schedule advancement commit together.
`SCHEDULER_POLL_SECONDS` defaults to 30; the maintenance loop checks elapsed
time between heartbeat updates. A new schedule first runs after its interval.
Disconnecting an AWS connection disables its schedules in the same transaction.

Workers write database heartbeats and update a local heartbeat file. Gateway
`/health` checks PostgreSQL, Redis, and whether any worker heartbeat is newer
than 90 seconds; it returns 503 when degraded. Redis failure can degrade health
while database-backed jobs continue. `/ready` checks access to the migrations
table and is the gateway's container readiness probe.

## Evidence and report generation

The worker resolves the caller's AWS account with STS and records account,
connection, region, mode, selected services, and schema version in report
context. Selected scanners run through guards that preserve unavailable
evidence as `UNKNOWN`. Reports include coverage, check counts, findings,
CIS evidence, correlations, and comparisons against the latest matching context.

Scores count failed resource checks only, excluding correlated annotations.
Unknown checks make the score provisional; no assessed pass/fail checks means
no score. See [AWS checks](AWS.md) for scope and evidence semantics.

## Persistence and access

Both gateway and worker run the same [versioned SQL migrations](DATABASE.md)
under a transaction-scoped advisory lock. Users, connections, schedules,
tasks, and reports live in PostgreSQL. The unique single-owner index prevents
concurrent registrations from creating multiple owners. Protected API requests
validate both the JWT and the continued existence of its account.

The deployment binds to loopback by default. Connected AWS roles use AssumeRole
with an External ID; role credentials remain in worker memory. Optional Gemini
requests originate from the gateway, where the provider key is configured.
