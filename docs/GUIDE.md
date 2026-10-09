# Console and developer guide

Cloud-Sentinel is a single-owner AWS configuration auditing platform. Follow
[Deployment](DEPLOYMENT.md) to start it, then open http://localhost:8080
(container stack) or http://localhost:3001 (local development).

## First use

1. Create the installation's owner account on the login page. Registration
   closes once an owner exists, enforced by a database unique index.
2. Sign in. Sessions last one hour.
3. Use **Accounts** to connect an AWS role, or scan with the worker's own AWS
   identity. Connection setup is described in [AWS](AWS.md).
4. Start a scan from the console, selecting the connection, region, and services.
5. Follow progress in **Scans**, then open the linked report.

If you forget the password, use the private
[owner recovery command](DEPLOYMENT.md#owner-password-recovery).

## Console pages

| Page | Purpose |
| --- | --- |
| Overview (`/`) | Latest scoped assessment, score, severity distribution, trends, and priority findings |
| Accounts (`/accounts`) | Connect and disconnect AWS roles; inspect their scan history |
| Scans (`/scans`) | Start scans, follow attempts and progress, filter status, and dismiss failed jobs |
| Findings (`/findings`) | Filter findings and inspect evidence and remediation |
| Compliance (`/compliance`) | Review passing/failing CIS-mapped control evidence |
| Policies (`/policies`) | Write immutable read-only YAML policy versions and evaluate them against saved reports |
| Query (`/query`) | Run a restricted SQL-like query over saved finding snapshots |
| Reports (`/reports`) | Browse assessment snapshots |
| Report detail (`/reports/:id`) | Inspect scope and coverage, export sanitized JSON/offline HTML/SARIF, print, or request optional AI insights |
| Schedules (`/schedules`) | Create recurring scans, pause/resume them, and inspect their last run |
| Settings (`/settings`) | View owner access, runtime configuration, dependency health, and account deletion |

Runtime configuration is set in the deployment environment. Deleting the
owner requires the current password and removes connections, schedules,
tasks, and reports through database cascades; it does not delete AWS resources.

## Reading results

Checks report `PASS`, `FAIL`, `UNKNOWN`, or `SKIPPED`. Missing permissions or
unavailable AWS evidence produce `UNKNOWN`; empty service inventories can
produce `SKIPPED`. A task with unknown checks finishes as `partial` and still
has a report. Its score is provisional. If no checks pass or fail, the score
and grade are absent (`null`).

The observed score runs from 0 to 100, with higher values indicating fewer
observed failures. CIS summaries cover selected checks and resources only.
Comparisons require matching account, connection, region, mode, service set,
and schema version. Missing evidence is tracked separately from resolution.
Older reports without scope metadata are marked as legacy assessments.

## Querying saved reports

The **Query** page prototypes cross-report search over the latest 100 reports
already loaded for the selected account scope. It accepts a small allowlisted
SQL-like syntax, not general SQL. Supported form:

```sql
SELECT report_id, scanned_at, region, status, severity, type, resource
FROM findings
WHERE status = 'FAIL' AND severity = 'critical'
ORDER BY scanned_at DESC
LIMIT 100
```

Fields are `finding_id`, `report_id`, `scanned_at`, `account_id`, `region`,
`status`, `severity`, `type`, `category`, `resource`, and `title`. Conditions
use `AND` with `=`, `!=`, numeric/date comparisons, or `CONTAINS`; `LIMIT` is
1–500 and defaults to 100. The query runs in the browser over saved snapshots.
It cannot access PostgreSQL, call AWS, or launch a scan. Unknown and skipped
statuses do not satisfy negative status filters. Use the report page when you
need more than the latest 100 snapshots.

## Request lifecycle

1. The gateway validates the session and requested scan configuration.
2. It stores a queued `audit_tasks` row and attempts a Redis wakeup.
3. A worker claims a due row with a renewable database lease.
4. The worker resolves AWS identity and gathers selected service evidence.
5. It saves the report and terminal task state in one transaction.
6. The dashboard polls the API to refresh status and fetch reports.

Interrupted jobs can be recovered after lease expiry. Task-level failures
retry with exponential backoff before becoming `error`. See
[Architecture](ARCHITECTURE.md) for the processing details.

## Working on the project

The gateway owns authentication and the REST API; the dashboard uses those
endpoints through NGINX or its development proxy. The Python worker owns AWS
calls and report generation. Both backend processes apply the shared SQL
files in `gateway/migrations` at startup.

Use [Testing](TESTING.md) for dependency installation and verification commands.
Gateway and worker unit tests use mocked dependencies; a separate suite
exercises real PostgreSQL behavior.
For new scan checks, follow [Extending the scanner](AWS.md#extending-the-scanner).
