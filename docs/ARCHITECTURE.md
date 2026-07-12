# 🏗️ System Architecture

This document describes the architecture of Cloud-Sentinel, how its services communicate, and the design decisions behind the system.

---

# High-Level Architecture

```text
                     ┌────────────────────┐
                     │       Client       │
                     └──────────┬─────────┘
                                │
                                ▼
                     ┌────────────────────┐
                     │       NGINX        │
                     └──────────┬─────────┘
                                │
               ┌────────────────┴────────────────┐
               ▼                                 ▼
    ┌────────────────────┐             ┌────────────────────┐
    │     Dashboard      │             │      Gateway       │
    │      (Next.js)     │             │   (Node.js/Express)│
    └────────────────────┘             └──────────┬─────────┘
                                                  │
                                                  ▼
                                         ┌────────────────┐
                                         │     Redis      │
                                         │  audit_tasks   │
                                         └────────┬───────┘
                                                  │
                                                  ▼
                                         ┌────────────────┐
                                         │     Worker     │
                                         │    (Python)    │
                                         └────────┬───────┘
                                                  │
                          ┌───────────────────────┴───────────────────────┐
                          ▼                                               ▼
                 ┌────────────────┐                           ┌────────────────────┐
                 │   AWS Services │                           │    PostgreSQL      │
                 │ S3•EC2•IAM•RDS │                           │  Audit Reports DB  │
                 └────────────────┘                           └────────────────────┘
```

---

# Components

## Gateway

Responsibilities:

* User authentication
* JWT validation
* Queue audit requests
* Fetch audit reports
* Communicate with PostgreSQL

---

## Dashboard

Responsibilities:

* User interface
* Login
* Trigger audits
* View reports

---

## Redis

Responsibilities:

* Store pending audit tasks
* Decouple API requests from long-running scans
* Enable asynchronous processing
* Hold permanently-failed tasks for inspection (dead-letter queue)

Queues used:

```text
audit_tasks       - pending work, consumed via BRPOP
audit_tasks_dead  - tasks that failed every retry attempt
```

---

## Worker

Responsibilities:

* Listen for audit tasks
* Mark each task `running` in `audit_tasks`, then `done`/`error` when finished
* Execute AWS scans
* Build report
* Save results to PostgreSQL
* Retry failed tasks with a fixed delay (`MAX_TASK_RETRIES`,
  `TASK_RETRY_DELAY_SECONDS`, default 3 retries / 5s delay); tasks that
  exhaust their retries are pushed to `audit_tasks_dead` and marked `error`

---

## PostgreSQL

Stores:

* Users
* Audit reports
* Audit task status (`audit_tasks`: queued → running → done/error)

---

## AWS

Current supported services:

* Amazon S3 (public access, encryption)
* Amazon EC2 (running instances, open security groups)
* AWS IAM (user MFA, root MFA, unused/stale access keys)
* Amazon RDS (public accessibility, storage encryption)

Additional services can be added by creating new scan modules.

---

# Request Lifecycle

```text
User
 │
 ▼
Dashboard
 │
 ▼
Gateway
 │
 ▼
Redis Queue
 │
 ▼
Worker
 │
 ▼
AWS APIs
 │
 ▼
Audit Report
 │
 ▼
PostgreSQL
 │
 ▼
Dashboard
```

---

# Why Asynchronous Processing?

AWS security scans may take several seconds depending on the number of resources.

Instead of making users wait for the API response:

1. The Gateway immediately queues the task.
2. The Worker processes it independently.
3. Users can retrieve the completed report later.

This architecture improves:

* Responsiveness
* Reliability
* Scalability

---

# Scalability

Cloud-Sentinel is designed to scale horizontally.

Possible scaling strategy:

```text
                 Redis
                   │
     ┌─────────────┼─────────────┐
     ▼             ▼             ▼
 Worker 1      Worker 2      Worker 3
```

Benefits:

* Multiple audit jobs can run simultaneously.
* Increased throughput.
* Better resource utilization.

---

# Design Principles

* Separation of concerns
* Modular scan implementation
* Queue-based asynchronous processing
* Stateless API services
* Extensible architecture for future AWS services

---

# Future Architecture

Potential improvements include:

* Scheduled audits
* Email notifications
* WebSocket-based live status updates (currently the dashboard polls `GET /api/audit/:task_id`)
* Support for additional AWS services (Lambda, ECS)
* Cloud deployment using Kubernetes
