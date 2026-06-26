# 🗄️ Database Design

This document describes the database schema used by Cloud-Sentinel and how audit reports are stored.

---

# Overview

Cloud-Sentinel uses **PostgreSQL** as its primary database.

The database stores:

* User accounts
* Audit reports
* Audit metadata

PostgreSQL was chosen because it provides:

* ACID-compliant transactions
* Excellent JSON support (JSONB)
* High reliability
* Strong indexing and query capabilities

---

# Database Schema

## audit_reports

Stores the results of completed AWS security audits.

| Column     | Type        | Description                  |
| ---------- | ----------- | ---------------------------- |
| id         | SERIAL      | Primary key                  |
| user_id    | INTEGER     | User who initiated the audit |
| task_id    | TEXT        | Redis task identifier        |
| report     | JSONB       | Complete audit report        |
| created_at | TIMESTAMPTZ | Audit completion timestamp   |

---

# Report Structure

Each report is stored as a JSON document.

Example:

```json id="o0ezj2"
{
  "findings": [
    {
      "type": "S3PublicAccess",
      "severity": "critical",
      "resource": "my-bucket",
      "details": "Bucket is publicly accessible"
    },
    {
      "type": "SecurityGroupOpen",
      "severity": "high",
      "resource": "sg-0123456789",
      "details": "Port 22 is open to the internet"
    }
  ]
}
```

Using **JSONB** allows the report structure to evolve without requiring database schema changes.

---

# Data Flow

```text id="6t4mlv"
Gateway
    │
    ▼
Redis Queue
    │
    ▼
Worker
    │
    ▼
AWS Scan Results
    │
    ▼
Build Report
    │
    ▼
PostgreSQL
```

---

# Relationships

```text id="kdx47p"
Users
   │
   │ 1
   │
   ▼
Audit Reports
```

Each user can own multiple audit reports.

---

# Why JSONB?

Audit findings can vary depending on:

* AWS services scanned
* Number of resources
* Types of security issues

Using **JSONB** provides:

* Flexible storage
* Efficient querying
* No schema migrations when new finding types are introduced

---

# Example Queries

Retrieve all audit reports:

```sql id="9h2ajz"
SELECT *
FROM audit_reports
ORDER BY created_at DESC;
```

Retrieve reports for a specific user:

```sql id="uhggzc"
SELECT *
FROM audit_reports
WHERE user_id = 1
ORDER BY created_at DESC;
```

Retrieve reports by task ID:

```sql id="wyqzq0"
SELECT *
FROM audit_reports
WHERE task_id = 'abc123';
```

---

# Data Lifecycle

1. User starts an audit.
2. Gateway creates a task.
3. Worker executes AWS scans.
4. Worker generates a report.
5. Report is stored in PostgreSQL.
6. Dashboard retrieves reports through the Gateway API.

---

# Future Improvements

Potential enhancements include:

* Separate table for individual findings
* Report versioning
* Soft deletes
* Audit history
* Indexing on frequently queried JSON fields
* Retention policies for old reports
* Export reports to external storage

These improvements can be implemented without changing the overall architecture.
