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
                 │  S3 • EC2 • IAM│                           │  Audit Reports DB  │
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

Queue used:

```text
audit_tasks
```

---

## Worker

Responsibilities:

* Listen for audit tasks
* Execute AWS scans
* Build report
* Save results to PostgreSQL

---

## PostgreSQL

Stores:

* Users
* Audit reports
* Scan metadata

---

## AWS

Current supported services:

* Amazon S3
* Amazon EC2
* AWS IAM

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
* WebSocket-based live status updates
* Retry mechanism for failed jobs
* Support for additional AWS services (RDS, Lambda, ECS)
* Cloud deployment using Kubernetes
