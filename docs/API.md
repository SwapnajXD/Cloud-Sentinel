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

---

# Endpoints

## Health Check

Checks whether the Gateway service is running.

### Request

```http
GET /health
```

### Response

```json
{
  "status": "ok"
}
```

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
  "username": "john",
  "password": "password123"
}
```

### Success Response

```json
{
  "message": "User registered successfully"
}
```

---

## Login

Authenticates a user and returns a JWT.

### Request

```http
POST /api/login
Content-Type: application/json
```

Request body:

```json
{
  "username": "john",
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

Queues a new AWS security audit.

### Request

```http
POST /api/audit
Authorization: Bearer <jwt-token>
```

### Success Response

```json
{
  "status": "queued",
  "task_id": "abc123"
}
```

The audit runs asynchronously in the Worker service.

---

## Get Audit Reports

Returns all audit reports for the authenticated user.

### Request

```http
GET /api/reports
Authorization: Bearer <jwt-token>
```

### Example Response

```json
{
  "reports": [
    {
      "task_id": "abc123",
      "created_at": "2026-06-26T10:30:00Z",
      "findings": [
        {
          "type": "S3PublicAccess",
          "severity": "critical",
          "resource": "example-bucket",
          "details": "Bucket is publicly accessible"
        }
      ]
    }
  ]
}
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
| 400  | Invalid request                          |
| 401  | Authentication required or invalid token |
| 403  | Access denied                            |
| 404  | Resource not found                       |
| 500  | Internal server error                    |

---

# Error Response Format

Errors are returned as JSON.

Example:

```json
{
  "error": "Unauthorized"
}
```

---

# Example Workflow

1. Register a new user.
2. Login to receive a JWT.
3. Start an audit using `/api/audit`.
4. Wait for the Worker to process the task.
5. Retrieve the completed report using `/api/reports`.

---

# Notes

* All request and response bodies use JSON.
* Audit execution is asynchronous.
* JWT authentication is required for protected endpoints.
* Reports are persisted in PostgreSQL after the Worker completes processing.
