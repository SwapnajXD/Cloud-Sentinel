# 🚀 Deployment Guide

This document explains how to deploy and run Cloud-Sentinel in a local development environment and outlines considerations for production deployments.

---

# Prerequisites

Before starting the project, ensure the following are installed:

* Docker
* Docker Compose
* Node.js (for local development)
* Python 3.11+
* AWS CLI v2

Verify your installations:

```bash
docker --version
docker compose version
node --version
python --version
aws --version
```

---

# AWS Authentication

Cloud-Sentinel uses your AWS CLI credentials.

Login to AWS:

```bash
aws login
```

Export credentials:

```bash
aws configure export-credentials
```

The `start.sh` script automatically exports these credentials as environment variables before launching Docker containers.

No AWS credentials are stored in the repository.

---

# Environment Variables

The project uses the following environment variables.

| Variable                | Description                             |
| ----------------------- | ---------------------------------------- |
| DATABASE_URL            | PostgreSQL connection string            |
| REDIS_URL               | Redis connection string                 |
| JWT_SECRET              | **Required.** Secret used to sign JWT tokens. The gateway refuses to start if this is unset - there is no default. Generate with `openssl rand -base64 48`. |
| ALLOWED_ORIGIN          | Comma-separated list of origins allowed to call the gateway from a browser. Leave blank and cross-origin requests are blocked in production (allowed in local dev). |
| POSTGRES_PASSWORD       | Password for the `postgres` user used by both the `db` service and the gateway/worker connection string. Change beyond local dev. |
| FLOCI_ENDPOINT          | Endpoint of a local AWS-API-compatible mock (e.g. LocalStack), used when `mode: "floci"` is passed to `/api/audit`. Leave blank if only auditing real AWS. |
| MAX_TASK_RETRIES        | Number of times the worker retries a failed audit task before dead-lettering it. Default 3. |
| TASK_RETRY_DELAY_SECONDS| Delay between retry attempts. Default 5. |
| SCHEDULER_POLL_SECONDS  | How often the worker checks for due recurring scans (`scheduled_scans`). Default 60. |
| AWS_ACCESS_KEY_ID       | AWS access key (runtime)                |
| AWS_SECRET_ACCESS_KEY   | AWS secret key (runtime)                |
| AWS_SESSION_TOKEN       | Temporary session token (if applicable) |
| AWS_REGION              | AWS region                              |
| GEMINI_API_KEY          | Optional. Enables `/api/ai/summary`.    |

Most AWS variables are injected automatically by `start.sh`. All others are
read from `infra/.env` - copy `infra/.env.example` to `infra/.env` and fill
it in before running `docker compose up`.

---

# Starting the System

Launch every service with:

```bash
./start.sh
```

This script:

1. Retrieves AWS credentials
2. Exports environment variables
3. Starts Docker Compose
4. Launches:

* Gateway
* Dashboard
* Worker
* Redis
* PostgreSQL
* NGINX

---

# Docker Services

The application consists of the following containers:

| Service   | Purpose              |
| --------- | -------------------- |
| gateway   | REST API             |
| worker    | AWS audit processing |
| dashboard | Web interface        |
| redis     | Task queue           |
| postgres  | Database             |
| nginx     | Reverse proxy        |

Check running containers:

```bash
docker compose ps
```

View logs:

```bash
docker compose logs -f
```

---

# Running Tests

Gateway tests (from `gateway/`) - includes both unit tests for the JWT
helpers and full integration tests against every exposed API route (via
supertest, with Postgres/Redis mocked so no live infra is needed):

```bash
npm test
```

Worker tests (from `worker/`, with `../tests` containing the test files):

```bash
python -m unittest discover -s ../tests -p "test_worker.py"
```

---

# Scaling Workers

Because audit processing is asynchronous, multiple Worker instances can run simultaneously.

Example:

```bash
docker compose up --scale worker=3
```

Redis distributes queued audit tasks among available workers.

Benefits:

* Faster processing
* Higher throughput
* Improved scalability

---

# Production Considerations

For a production deployment, consider:

* Deploy PostgreSQL using Amazon RDS
* Use Amazon ElastiCache for Redis
* Store secrets in AWS Secrets Manager
* Use IAM Roles instead of long-lived credentials
* Enable HTTPS with TLS certificates
* Configure automated backups
* Centralize logs with CloudWatch or another logging solution
* Add health checks and monitoring

---

# Deployment Workflow

```text
Developer
    │
    ▼
AWS Login
    │
    ▼
Export Credentials
    │
    ▼
Run start.sh
    │
    ▼
Docker Compose
    │
    ▼
All Services Started
```

---

# Stopping the Application

Stop all running containers:

```bash
docker compose down
```

Stop and remove volumes:

```bash
docker compose down -v
```

---

# Updating Services

After making code changes:

Rebuild containers:

```bash
docker compose up --build
```

Or rebuild a single service:

```bash
docker compose up --build worker
```

---

# Future Improvements

Potential deployment enhancements include:

* Kubernetes deployment
* GitHub Actions CI/CD
* Automated Docker image publishing
* Blue/Green deployments
* Infrastructure as Code (Terraform or AWS CDK)
* Automated security scanning during deployment
