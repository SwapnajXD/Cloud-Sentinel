# 📘 Developer Guide

Cloud-Sentinel is a distributed AWS auditing platform that scans AWS infrastructure for common security issues using an asynchronous worker architecture.

This guide explains how the system works, how its components interact, and how to run the project locally.

---

# Overview

Cloud-Sentinel consists of multiple services that work together:

* **Gateway (Node.js/Express)** — Authentication, API endpoints, and task creation
* **Redis** — Message queue for audit tasks
* **Worker (Python)** — Executes AWS scans asynchronously
* **PostgreSQL** — Stores audit reports
* **Dashboard (Next.js)** — User interface for triggering audits and viewing reports
* **NGINX** — Reverse proxy for routing frontend and API traffic

---

# Execution Flow

1. User logs into the dashboard.
2. User starts an audit.
3. The Gateway validates the JWT.
4. A new audit task is pushed into the Redis queue (`audit_tasks`).
5. The Worker consumes the task.
6. The Worker:

   * Connects to AWS using boto3
   * Executes security scans
   * Builds an audit report
7. The report is stored in PostgreSQL.
8. The Dashboard retrieves reports through the Gateway.

---

# Project Components

## Gateway

Responsibilities:

* User registration
* User login
* JWT authentication
* Queue audit tasks
* Fetch audit reports

---

## Worker

Responsibilities:

* Listen to Redis queue
* Execute AWS security scans
* Build audit reports
* Store reports in PostgreSQL

---

## Dashboard

Responsibilities:

* User interface
* Trigger audits
* Display audit reports

---

## Redis

Responsibilities:

* Queue audit jobs
* Decouple API requests from long-running AWS scans

---

## PostgreSQL

Responsibilities:

* Store users
* Store audit reports
* Persist scan results

---

## NGINX

Responsibilities:

* Reverse proxy

* Route requests

* `/` → Dashboard

* `/api` → Gateway

---

# Running the Project

Start all services:

```bash
./start.sh
```

This script:

* Exports AWS credentials
* Starts Docker Compose
* Launches all services

---

# Testing

Run the end-to-end workflow:

```bash
./test-flow.sh
```

Run Gateway tests:

```bash
npm test
```

Run Worker tests:

```bash
python -m unittest discover
```

---

# Design Decisions

## Why Redis?

Redis provides a lightweight, fast message queue that keeps the API responsive while AWS scans run asynchronously.

## Why a Worker?

AWS scans can take several seconds.

Moving them into a separate worker allows the Gateway to immediately return a response instead of blocking.

## Why Separate Scan Modules?

Each AWS service has its own scanning module.

Benefits:

* Easier maintenance
* Easier testing
* Easy to extend with new AWS services

---

# Future Improvements

* Add RDS scans
* Add Lambda scans
* Scheduled audits
* Email notifications
* Retry failed jobs
* Dashboard analytics
