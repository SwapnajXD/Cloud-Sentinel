# Database and migrations

PostgreSQL is the source of truth for owner access, scan jobs, reports, AWS
connections, schedules, and worker health. Redis carries wakeups only.

## Shared migrations

The gateway and worker apply the SQL files in
[`gateway/migrations`](../gateway/migrations) in filename order at startup.
They use advisory transaction lock `727001`, record filenames in
`schema_migrations(version, applied_at)`, and commit pending migrations together.
A failed migration rolls back rather than leaving a partially applied schema.
The worker's `MIGRATIONS_DIR` can override its migration directory; container
images include the shared files.

| Migration | Purpose |
| --- | --- |
| `001_baseline.sql` | Creates core tables, normalizes legacy timestamps as UTC, enforces ownership and cascading foreign keys, and creates the single-owner and normalized-email unique indexes |
| `002_durable_scans.sql` | Adds job payloads, leases, retry state, partial status, report task identity, schedule scope and pause state, connection soft disconnection, indexes, and worker heartbeats |

Existing databases with multiple users or invalid ownership data must be
reviewed before migration. The migration fails on those conflicts; it does
not silently delete or reassign data. Back up existing databases before an
upgrade. Migration 002 fills missing legacy task payloads and requeues legacy
running jobs that had no renewable leases.

Inspect applied versions through the Compose database service:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml exec db \
  psql -U postgres -d cloud_sentinel \
  -c 'SELECT version, applied_at FROM schema_migrations ORDER BY version;'
```

## Tables

| Table | Main columns and behavior |
| --- | --- |
| `users` | `id`, `email`, bcrypt `password`, `created_at`; a unique index on constant `true` permits only one owner; another index makes email uniqueness case-insensitive |
| `aws_connections` | `id`, `user_id`, `role_arn`, `external_id`, `label`, `region`, `active`, `created_at`; disconnect sets `active = false` |
| `audit_tasks` | See task fields below |
| `audit_reports` | `id`, `user_id`, `report` JSONB, `created_at`, unique nullable `task_id` referencing `audit_tasks` |
| `scheduled_scans` | `id`, `user_id`, `mode`, `interval_hours` (1–168), `next_run_at`, `created_at`, `connection_id`, `region`, `services` JSONB, `enabled`, `last_run_at`, `last_task_id` |
| `worker_heartbeats` | `worker_id`, `updated_at`; supports worker availability checks |
| `schema_migrations` | Applied migration filename and timestamp |

All core timestamps are `TIMESTAMPTZ`. Owner-owned rows reference `users(id)`
with `ON DELETE CASCADE`. Optional task/report, connection, and last-task
references use `ON DELETE SET NULL`; normal connection removal is a soft update.

## Task fields

| Field | Meaning |
| --- | --- |
| `task_id`, `user_id` | UUID text primary key and owning user |
| `status`, `mode` | `queued`, `running`, `done`, `partial`, or `error`; `aws` or `floci` |
| `connection_id`, `payload` | Selected connection and persisted JSONB request configuration |
| `report_id`, `error` | Completed report reference or failure description |
| `attempts`, `available_at` | Claim count and earliest next execution time |
| `lease_token`, `lease_until` | Current worker claim identity and expiry |
| `progress` | Human-readable processing stage |
| `dismissed` | Hides a terminal failure from the dead-letter listing |
| `created_at`, `updated_at` | Creation and last state update |

Indexes cover owner report/task history, due queued jobs, and enabled schedules.
Report insertion and terminal task update commit atomically after lease validation.
See [Architecture](ARCHITECTURE.md) for retry and recovery behavior.

## Reports

New reports have `schema_version: 2`. The JSONB payload includes `task_id`,
request/completion timestamps, `duration_sec`, `context`, `connection_label`,
`coverage`, `check_summary`, `partial`, `score_provisional`, `risk_score`,
`risk_grade`, `cis_summary`, `diff`, and `findings`.

Context records account ID, connection ID, region, mode, sorted service list,
and schema version. Comparisons select the latest report with equal context.
Legacy reports may lack these fields and the relational `task_id`; the console
keeps them readable without inventing missing coverage.

The JSONB report also contains `task_id`, but new reports have a dedicated
unique `task_id` column for persistence guarantees. `audit_tasks.report_id`
provides the reverse reference used by the API.

## Useful queries

```sql
SELECT task_id, status, attempts, progress, lease_until, error
FROM audit_tasks
WHERE user_id = 1
ORDER BY created_at DESC;

SELECT id, task_id, created_at, report->'context' AS context
FROM audit_reports
WHERE user_id = 1
ORDER BY created_at DESC;

SELECT id, enabled, next_run_at, last_task_id
FROM scheduled_scans
WHERE user_id = 1;
```

[Database integration tests](TESTING.md#postgresql-integration-tests) exercise
migrations, ownership, concurrent claims, lease expiry, completion transactions,
schedules, and cascading deletion against disposable PostgreSQL databases.
