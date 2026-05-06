# Cloud-Sentinel

A distributed AWS auditing platform with microservices architecture. Built with Node.js/TypeScript gateway, Python worker, Redis queue, PostgreSQL database, and Nginx proxy.

## Quick Start

```bash
cp .env.example .env
sudo docker compose up --build -d
curl http://localhost/health
```

## What it does

- User authentication with JWT
- Queue AWS audit tasks via REST API
- Scan AWS for unencrypted S3 buckets, EC2 instances, and IAM MFA status
- Store audit results in PostgreSQL

## Tech Stack

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

## Documentation

- **[GUIDE.md](GUIDE.md)** - Complete API reference, architecture, deployment, and troubleshooting
- **Tests**: `npm test` (Node) and `python -m unittest discover` (Python)
