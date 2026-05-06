# Cloud-Sentinel

A distributed AWS auditing platform with microservices architecture. Built with Next.js dashboard, Node.js/TypeScript gateway, Python worker, Redis queue, PostgreSQL database, and Nginx proxy.

## Quick Start

```bash
# 1. Setup environment
cp .env.example .env

# 2. Configure AWS credentials
aws login
eval $(aws configure export-credentials --format env)
# Update .env with: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN, AWS_REGION

# 3. Start services
sudo docker compose up --build -d

# 4. Verify health
curl http://localhost/health
```

## What it does

- Secure user authentication with JWT tokens
- Queue AWS audit tasks via REST API
- Scan AWS for unencrypted S3 buckets, running EC2 instances, and IAM MFA status
- Store audit results in PostgreSQL
- Web dashboard for managing audits and viewing reports

## Resume Positioning

Use this project as either of these, depending on the role:

**Backend-focused:**
- Built a backend-heavy AWS auditing platform with REST APIs for authentication, task queueing, report retrieval, and account management.
- Implemented JWT auth, PostgreSQL persistence, Redis-based job processing, and a Python worker that stores audit results.

**DevOps-focused:**
- Deployed a containerized multi-service stack with Docker Compose, Nginx reverse proxying, Redis, PostgreSQL, a Next.js dashboard, an Express gateway, and a Python worker.
- Managed AWS credentials through environment-based configuration and debugged cross-service deployment issues across the frontend, API, and worker.

## Tech Stack

- **Dashboard**: Next.js 14.2 (React, TypeScript)
- **Gateway**: Node.js + Express (TypeScript)
- **Queue**: Redis
- **Worker**: Python + boto3
- **Database**: PostgreSQL
- **Proxy**: Nginx

## Core Endpoints

- `GET /health` - Health check
- `POST /api/register` - Create user
- `POST /api/login` - Get JWT token
- `POST /api/audit` - Queue audit (requires auth)
- `GET /api/reports` - Fetch reports (requires auth)
- `DELETE /api/account` - Delete account (requires auth)

## End-to-End Testing

Run the terminal-based test script to verify the entire pipeline:

```bash
./test-flow.sh
```

This will:
1. Register a user
2. Log in and get JWT token
3. Queue an audit task
4. Wait for worker to process
5. Fetch and display audit reports

## Documentation

- **[GUIDE.md](GUIDE.md)** - Complete API reference, architecture, setup, and troubleshooting
- **Tests**: `npm test` (Node) and `python -m unittest discover` (Python)
