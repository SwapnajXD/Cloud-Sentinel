# API reference

The default container API is **http://localhost:8080/api**. Local development
uses **http://localhost:3001/api** through the dashboard proxy, or the gateway
directly at **http://localhost:3000/api**. Health/readiness probes are served
by NGINX and the gateway outside `/api`.

Requests and normal responses use JSON. Protected endpoints require:

```http
Authorization: Bearer <jwt-token>
```

All `/api` requests are limited to 180 per minute per IP. Login and registration
also share a 10-attempt limit per 15 minutes per IP. Request bodies are limited
to 1 MB. Validation errors use `{ "error": "message" }`; rate limits return 429.

## Public setup and authentication

| Method / route | Request and response |
| --- | --- |
| `GET /api/setup` | `{ "registration_open": true, "single_user": true }`; registration closes when an owner exists |
| `POST /api/register` | `{ "email": "owner@example.com", "password": "example-password-123" }` → 201 `{ "id": 1, "email": "owner@example.com" }` |
| `POST /api/login` | Same fields → `{ "token": "<jwt-token>" }`; invalid credentials return 401 |

Emails are trimmed and lowercased. New passwords require at least 12 characters
and at most 72 UTF-8 bytes; login accepts existing passwords up to 72 bytes.
The database permits only one owner. Further registration returns 403 with
`registration closed: this installation already has an owner`.

JWTs use HS256 and expire after one hour. Protected requests also verify that
the owner still exists. There is no HTTP password-reset endpoint; use the
[private recovery command](DEPLOYMENT.md#owner-password-recovery).

## Scan configuration

Manual audits and recurring schedules accept these shared fields:

```json
{
  "mode": "aws",
  "connection_id": null,
  "region": "us-east-1",
  "services": ["s3", "ec2", "iam", "rds", "lambda"]
}
```

| Field | Rules |
| --- | --- |
| `mode` | `aws` (default) or `floci`; other values return 400 |
| `connection_id` | Positive ID of an active owned connection, or `null`/omitted for worker identity |
| `region` | Defaults to gateway `AWS_REGION`, then `us-east-1`; must match the region-name format |
| `services` | Nonempty subset of `s3`, `ec2`, `iam`, `rds`, `lambda`; defaults to all five; deduplicated and sorted |

Floci requires a configured `FLOCI_ENDPOINT` and cannot use a connection ID.
The API does not automatically choose a connected account when the ID is
omitted. An explicit connection must exist, be active, and belong to the owner.

## Audits and task history

`POST /api/audit` accepts scan configuration and persists a job. Returns 202:

```json
{
  "status": "queued",
  "mode": "aws",
  "task_id": "d0d820b2-793e-45f4-8937-87cd5a8ef274"
}
```

`GET /api/tasks?limit=50` returns `{ "tasks": [...] }`, newest first.
`GET /api/audit/:task_id` returns one task, or 404 when absent or not owned.
Both expose:

```json
{
  "task_id": "d0d820b2-793e-45f4-8937-87cd5a8ef274",
  "status": "partial",
  "mode": "aws",
  "connection_id": null,
  "report_id": 42,
  "error": null,
  "created_at": "2026-09-10T10:00:00Z",
  "updated_at": "2026-09-10T10:00:07Z",
  "attempts": 1,
  "progress": "Assessment complete",
  "payload": {
    "task_id": "d0d820b2-793e-45f4-8937-87cd5a8ef274",
    "action": "start_audit",
    "user_id": 1,
    "requested_at": "2026-09-10T10:00:00Z",
    "mode": "aws",
    "connection_id": null,
    "region": "us-east-1",
    "services": ["ec2", "iam", "lambda", "rds", "s3"],
    "params": { "scope": "selected-services" }
  }
}
```

Statuses are `queued`, `running`, `done`, `partial`, and `error`. Both `done`
and `partial` are terminal states with reports. A task-level failure returns
to `queued` while waiting to retry, then becomes `error` after the retry budget.
`attempts` counts all claims, including the first attempt.

Task/report list `limit` defaults to 50 and caps at 500; malformed or nonpositive
values return 400.

## Reports

- `GET /api/reports?limit=50` → `{ "reports": [...] }`, newest first.
- `GET /api/reports/:id` → `{ "id": 42, "report": {...}, "created_at": "..." }`;
  missing or unowned reports return 404.

Each list item has the same shape as the detail response. New report payloads
include schema version 2, task and timing metadata, account/scope `context`,
`coverage`, `check_summary`, `partial`, `score_provisional`, `risk_score`,
`risk_grade`, `cis_summary`, `diff`, and `findings`.

Findings have stable IDs, type, category, resource, region, status, severity,
evidence, and remediation. Status is `PASS`, `FAIL`, `UNKNOWN`, or `SKIPPED`.
Scores deduct critical/medium/low failure penalties of 15/5/1 from 100, floored
at zero, excluding correlations. Scores and grades are `null` when there are
no pass/fail checks. Unknown checks make scores provisional. CIS summaries
include unknown control groups and describe partial benchmark coverage.

See [AWS](AWS.md) and [Database](DATABASE.md) for the report contract. Legacy
reports can omit the new metadata.

## Recurring scans

| Method / route | Behavior |
| --- | --- |
| `POST /api/schedules` | Scan configuration plus integer `interval_hours` from 1 to 168; returns 201 with the created row |
| `GET /api/schedules` | `{ "schedules": [...] }`, newest first; includes scope, enabled state, next run, and last task/status/error |
| `PATCH /api/schedules/:id` | `{ "enabled": false }` pauses; `true` resumes; returns the updated row |
| `DELETE /api/schedules/:id` | Deletes an owned schedule; returns `{ "status": "success" }` |

The first run occurs after the chosen interval. Resuming resets `next_run_at`
to now plus the interval; a disconnected connection prevents resuming.
The worker checks due schedules using `SCHEDULER_POLL_SECONDS` (default 30).
Missing/unowned schedule updates or deletions return 404.

## AWS connections

`POST /api/aws-connections` accepts:

```json
{
  "role_arn": "arn:aws:iam::123456789012:role/CloudSentinelScanRole",
  "external_id": "a-unique-external-id-for-this-connection",
  "label": "Personal AWS",
  "region": "us-east-1"
}
```

Role ARN must be a valid IAM role ARN in the supported AWS partitions.
External ID must be 16–1224 characters using letters, digits, underscores,
or `+=,.@:/-`; label is optional and at most 80 characters. Region uses scan
configuration defaults and validation. Registration stores the configuration;
AWS access is exercised when a scan runs.

Returns 201 with `id`, `role_arn`, `label`, `region`, `active`, and `created_at`.
`GET /api/aws-connections` returns `{ "connections": [...] }`, including inactive
connections. Neither response returns the stored External ID.

`DELETE /api/aws-connections/:id` marks an active connection inactive and
pauses its schedules transactionally. It preserves scan history and returns
`{ "status": "success" }`; absent, unowned, or already inactive connections
return 404. It does not delete the AWS role.

## Failed jobs

`GET /api/dead-letter` returns up to 200 undismissed database failures, newest
first, wrapped in `{ "tasks": [...] }`. Fields are `task_id`, `user_id`, `mode`,
`final_error`, `_retries`, and `requested_at`. The compatibility field `_retries`
contains total attempts, including the first attempt.

`DELETE /api/dead-letter/:task_id` marks a failed job dismissed and returns
`{ "status": "success" }`. It neither retries the scan nor deletes task history.
Absent, unowned, or already dismissed failures return 404.

## Owner deletion

`DELETE /api/account` requires `{ "password": "current-password" }` and a JWT.
It returns `{ "status": "success" }` after deleting the owner and cascading
to connections, schedules, tasks, and reports. AWS resources are unaffected.
Incorrect passwords return 401. Owner deletion invalidates future requests
with the old token and reopens registration.

## Optional AI interpretation

`POST /api/ai/summary` accepts `{ "report_id": 42 }` to summarize an owned
report. It also accepts `{ "report": {...} }`; `report_id` takes precedence
when both are supplied. Report contents are sent to Gemini by the gateway.

Returns `{ "summary": "...", "generated_by": "<configured-model>" }`.
Missing `GEMINI_API_KEY` returns 503; missing reports return 404; provider
rejection, timeout, or unavailability returns 502. The gateway uses a
20-second provider timeout and `GEMINI_MODEL` (default `gemini-2.5-flash`).

## Health, readiness, and runtime settings

`GET /health` is public and returns 200 when all checks pass, or 503 when degraded:

```json
{
  "status": "ok",
  "uptime": 123.45,
  "checks": { "postgres": "ok", "redis": "ok", "worker": "ok" }
}
```

Worker health requires a database heartbeat within 90 seconds. Redis failure
degrades health even though database-backed scan processing can continue.

`GET /ready` is public, verifies access to `schema_migrations`, and returns
`{ "status": "ready" }` on success. Database errors use the normal 500 handler.

`GET /api/system` requires authentication and returns health plus `single_user`,
`region`, `services`, `ai_configured`, `floci_configured`, `template_url`,
`trusted_principal_arn`, `retry_limit`, `scheduler_poll_seconds`, and `version`.
Secret values are omitted.

## Example workflow

1. Check `/api/setup`; register only if registration is open.
2. Log in and save the token.
3. Start an audit with explicit scan scope; save `task_id`.
4. Poll the task until `done`, `partial`, or `error`.
5. For `done` or `partial`, fetch `/api/reports/:report_id` and inspect coverage.
