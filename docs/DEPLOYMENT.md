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

| Variable              | Description                             |
| --------------------- | --------------------------------------- |
| DATABASE_URL          | PostgreSQL connection string            |
| REDIS_URL             | Redis connection string                 |
| JWT_SECRET            | Secret used to sign JWT tokens          |
| AWS_ACCESS_KEY_ID     | AWS access key (runtime)                |
| AWS_SECRET_ACCESS_KEY | AWS secret key (runtime)                |
| AWS_SESSION_TOKEN     | Temporary session token (if applicable) |
| AWS_REGION            | AWS region                              |

Most AWS variables are injected automatically by `start.sh`.

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

Execute the end-to-end workflow:

```bash
./test-flow.sh
```

Gateway tests:

```bash
npm test
```

Worker tests:

```bash
python -m unittest discover
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
