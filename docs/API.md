# 🔌 API Reference

This document describes the REST API exposed by the Cloud-Sentinel Gateway service.

---

# Base URL

During local development:

```text
http://localhost/api
```

All API responses use JSON.

---

# Authentication

Protected endpoints require a JSON Web Token (JWT).

Include the token in the request header:

```http
Authorization: Bearer <your-jwt-token>
```

`/api/register` and `/api/login` are rate-limited to 10 requests per 15 minutes
per IP. All other `/api` routes are limited to 60 requests per minute per IP.

---

# Endpoints

## Health Check

Checks whether the Gateway service, Postgres, and Redis are reachable.

### Request

```http
GET /health
```

### Response

```json
{
  "status": "ok",
  "uptime": 123.45,
  "checks": { "postgres": "ok", "redis": "ok" }
}
```

`status` is `"degraded"` (HTTP 503) if either dependency check fails.

---

## Register User

Creates a new user account.

### Request

```http
POST /api/register
Content-Type: application/json
```

Request body:

```json
{
  "email": "john@example.com",
  "password": "password123"
}
```

Requirements: valid email format, password of at least 8 characters.

### Success Response

```json
{
  "id": 1,
  "email": "john@example.com"
}
```

### Error Responses

| Status | Body                             | Reason                     |
| ------ | -------------------------------- | --------------------------- |
| 400    | `{"error": "email and password required"}` | Missing fields |
| 400    | `{"error": "invalid email format"}` | Malformed email |
| 400    | `{"error": "weak password"}`     | Password under 8 chars      |
| 409    | `{"error": "email exists"}`      | Account already registered  |

---

## Login

Authenticates a user and returns a JWT (valid for 1 hour).

### Request

```http
POST /api/login
Content-Type: application/json
```

Request body:

```json
{
  "email": "john@example.com",
  "password": "password123"
}
```

### Success Response

```json
{
  "token": "<jwt-token>"
}
```

Save this token and include it in future requests.

---

## Start Audit

Queues a new security audit. Runs against real AWS by default, or against a
Floci (AWS-API-compatible local mock, e.g. LocalStack) endpoint if `mode` is
`"floci"` and `FLOCI_ENDPOINT` is configured on the worker.

### Request

```http
POST /api/audit
Authorization: Bearer <jwt-token>
Content-Type: application/json
```

Request body:

```json
{
  "mode": "aws",
  "params": {}
}
```

`mode` defaults to `"aws"` if omitted; any value other than `"floci"` is
treated as `"aws"`.

### Success Response

```json
{
  "status": "queued",
  "mode": "aws",
  "task_id": "5f2e1c3a-....-....-....-............"
}
```

The audit runs asynchronously in the Worker service. Use `task_id` with the
endpoint below to track progress.

---

## Get Audit Task Status

Checks the status of a previously queued audit.

### Request

```http
GET /api/audit/:task_id
Authorization: Bearer <jwt-token>
```

### Success Response

```json
{
  "task_id": "5f2e1c3a-....",
  "status": "done",
  "mode": "aws",
  "report_id": 42,
  "error": null,
  "created_at": "2026-07-11T10:00:00Z",
  "updated_at": "2026-07-11T10:00:07Z"
}
```

`status` is one of `queued`, `running`, `done`, or `error`. If the worker
retries a failed task, `status` may go back to `running` before finally
settling on `done` or `error` (after retries are exhausted).

Returns `404` if the task doesn't exist or doesn't belong to the
authenticated user.

---

## Get Audit Reports

Returns completed audit reports for the authenticated user, most recent first.

### Request

```http
GET /api/reports?limit=50
Authorization: Bearer <jwt-token>
```

`limit` is optional, defaults to 50, capped at 500.

### Example Response

```json
{
  "reports": [
    {
      "id": 42,
      "created_at": "2026-07-11T10:00:07Z",
      "report": {
        "task_id": "5f2e1c3a-....",
        "user_id": 1,
        "summary": { "total": 3, "critical": 1, "medium": 1, "good": 1 },
        "risk_score": 78,
        "risk_grade": "B",
        "cis_summary": {
          "version": "CIS AWS Foundations Benchmark v1.4.0",
          "controls_assessed": 2,
          "controls_passing": 1,
          "controls_failing": 1
        },
        "findings": [
          {
            "type": "S3PublicAccess",
            "category": "S3",
            "severity": "critical",
            "resource": "example-bucket",
            "title": "Public S3 bucket",
            "description": "Bucket is publicly accessible.",
            "remediation": "Remove public ACL or block public access.",
            "cis": {
              "control_id": "2.1.5",
              "control_title": "Ensure that S3 Buckets are configured with 'Block Public Access'",
              "version": "CIS AWS Foundations Benchmark v1.4.0"
            }
          }
        ]
      }
    }
  ]
}
```

`risk_score` is a transparent 0-100 score (start at 100, deduct a fixed
penalty per finding by severity: critical -15, medium -5, low -1, floored
at 0) with a letter grade (A-F). `cis` only appears on findings that
correspond to a real CIS AWS Foundations Benchmark control - RDS and
Lambda findings, for example, don't get one, since those services aren't
part of that particular benchmark.

---

## Create Recurring Scan

Schedules a scan to run automatically on a fixed interval. The worker's
background scheduler checks for due schedules every `SCHEDULER_POLL_SECONDS`
(default 60s) and enqueues them exactly like a manually-triggered scan.

### Request

```http
POST /api/schedules
Authorization: Bearer <jwt-token>
Content-Type: application/json
```

```json
{ "mode": "aws", "interval_hours": 24 }
```

`interval_hours` must be an integer between 1 and 168 (one week).

### Success Response

```json
{
  "id": 1,
  "mode": "aws",
  "interval_hours": 24,
  "next_run_at": "2026-07-15T10:00:00Z",
  "created_at": "2026-07-14T10:00:00Z"
}
```

---

## List Recurring Scans

```http
GET /api/schedules
Authorization: Bearer <jwt-token>
```

Returns `{ "schedules": [...] }` for the authenticated user, most recent first.

---

## Cancel Recurring Scan

```http
DELETE /api/schedules/:id
Authorization: Bearer <jwt-token>
```

Returns `404` if the schedule doesn't exist or doesn't belong to the caller.

---

## List Dead-Lettered Scans

Scans that failed every retry attempt end up here instead of vanishing
silently. Only returns entries belonging to the authenticated user.

```http
GET /api/dead-letter
Authorization: Bearer <jwt-token>
```

```json
{
  "tasks": [
    {
      "task_id": "5f2e1c3a-....",
      "user_id": 1,
      "mode": "aws",
      "requested_at": "2026-07-14T09:00:00Z",
      "final_error": "FLOCI_ENDPOINT not set",
      "_retries": 3
    }
  ]
}
```

---

## Dismiss a Dead-Lettered Scan

```http
DELETE /api/dead-letter/:task_id
Authorization: Bearer <jwt-token>
```

Removes the entry from the dead-letter queue. Returns `404` if it doesn't
exist or belongs to someone else.

---

## Delete Account

Deletes the authenticated user's account and all of their audit reports
(cascading delete). Requires re-entering the account password to confirm.

### Request

```http
DELETE /api/account
Authorization: Bearer <jwt-token>
Content-Type: application/json
```

```json
{ "password": "password123" }
```

### Success Response

```json
{ "status": "success" }
```

---

## AI Summary (optional)

Generates a natural-language summary of a report using Gemini. Requires
`GEMINI_API_KEY` to be configured on the gateway.

### Request

```http
POST /api/ai/summary
Authorization: Bearer <jwt-token>
Content-Type: application/json
```

```json
{ "report": { "...": "a report object from /api/reports" } }
```

### Success Response

```json
{ "summary": "..." }
```

---

# Authentication Flow

```text
Register
    │
    ▼
Login
    │
    ▼
Receive JWT
    │
    ▼
Include JWT in Authorization header
    │
    ▼
Access protected endpoints
```

---

# HTTP Status Codes

| Code | Description                              |
| ---- | ---------------------------------------- |
| 200  | Request successful                       |
| 201  | Resource created                         |
| 202  | Audit queued                             |
| 400  | Invalid request                          |
| 401  | Authentication required or invalid token |
| 403  | Access denied                            |
| 404  | Resource not found                       |
| 429  | Rate limit exceeded                      |
| 500  | Internal server error                    |
| 503  | Dependency (Postgres/Redis) unavailable  |

---

# Error Response Format

Errors are returned as JSON.

Example:

```json
{
  "error": "invalid credentials"
}
```

---

# Example Workflow

1. Register a new user via `/api/register`.
2. Login via `/api/login` to receive a JWT.
3. Start an audit using `POST /api/audit`, save the returned `task_id`.
4. Poll `GET /api/audit/:task_id` until `status` is `done` or `error`.
5. Retrieve the completed report using `GET /api/reports`.

---

# Notes

* All request and response bodies use JSON.
* Audit execution is asynchronous; failed tasks are retried by the worker
  (see `docs/ARCHITECTURE.md`) before being marked `error`.
* JWT authentication is required for protected endpoints.
* Reports are persisted in PostgreSQL after the Worker completes processing.
