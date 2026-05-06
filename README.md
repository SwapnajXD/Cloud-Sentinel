# Cloud-Sentinel

Cloud-Sentinel is a small distributed AWS auditing platform built with:

- a Node.js/Express auth gateway
- Redis as the task queue
- a Python worker that performs AWS scans
- PostgreSQL for user and audit report storage
- Nginx as the reverse proxy

## What it does

- Register and log in users with hashed passwords
- Issue JWTs for authenticated requests
- Queue `start_audit` tasks in Redis through `POST /api/audit`
- Consume tasks in the Python worker
- Scan AWS for:
  - unencrypted S3 buckets
  - running EC2 instances
  - MFA status for the current IAM user
- Store scan results in PostgreSQL

## Project Layout

- `server.js` - Express API gateway
- `lib/auth.js` - JWT helpers and middleware
- `worker.py` - Redis consumer and AWS audit worker
- `docker-compose.yml` - local stack definition
- `Dockerfile.gateway` - Node service image
- `Dockerfile.worker` - Python service image
- `nginx/nginx.conf` - reverse proxy config
- `tests/` - unit tests for the gateway and worker

## Prerequisites

- Docker and Docker Compose
- Optional for local tests: Node.js 18+ and Python 3.11+

## Quick Start

1. Copy the example env file:

```bash
cp .env.example .env
```

2. Start the full stack:

```bash
sudo docker compose up --build
```

3. Open the API through Nginx:

```bash
curl http://localhost/health
```

If you prefer a detached start:

```bash
sudo docker compose up --build -d
```

## Local Endpoints

- `GET /health` - gateway health check
- `POST /api/register` - create a user
- `POST /api/login` - return a JWT
- `POST /api/audit` - queue an audit task, requires `Authorization: Bearer <token>`

## Example Flow

1. Register a user:

```bash
curl -X POST http://localhost/api/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.com","password":"demo-password"}'
```

2. Log in and capture the token:

```bash
curl -X POST http://localhost/api/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.com","password":"demo-password"}'
```

3. Queue an audit:

```bash
curl -X POST http://localhost/api/audit \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <paste-token-here>' \
  -d '{"params":{"scope":"default"}}'
```

## Tests

Run the Node.js tests:

```bash
npm test
```

Run the Python worker tests in a virtual environment:

```bash
python -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
```

## Notes

- The worker needs valid AWS credentials before real scans will succeed.
- The default database credentials in `.env.example` match the Docker Compose Postgres service.
- `.env` is ignored by git, so keep secrets out of the repository.
