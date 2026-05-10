# Cloud-Sentinel

A distributed AWS auditing platform with microservices architecture.

## Project Overview

- **Purpose**: Scan and monitor AWS infrastructure for security issues (S3 encryption, EC2 instances, IAM MFA status)
- **Stack**: Next.js dashboard, Node.js/Express gateway (TypeScript), Python worker, Redis queue, PostgreSQL, Nginx proxy

## Key Commands

```bash
# Start all services
sudo docker compose up --build -d

# Build TypeScript gateway
npm run build

# Run gateway in watch mode
npm run dev

# Run gateway tests
npm test

# Run worker tests
python -m unittest discover tests -p "test_*.py" -v

# End-to-end test
./test-flow.sh

# View logs
sudo docker compose logs -f

# Rebuild everything
sudo docker compose down -v && sudo docker compose up --build -d
```

## Key Files

- `server.ts` - Express gateway with auth, task queue, report endpoints
- `lib/auth.ts` - JWT helpers and middleware
- `worker.py` - Python AWS scanner (boto3)
- `dashboard/` - Next.js frontend (port 3001)
- `docker-compose.yml` - Service orchestration

## Architecture

```
Nginx (80) -> Gateway (3000) -> Redis queue -> Worker
                              -> PostgreSQL
Dashboard (3001) proxies to Gateway
```

## API Endpoints

- `GET /health` - Health check
- `POST /api/register` - User registration
- `POST /api/login` - Get JWT token
- `POST /api/audit` - Queue audit (auth required)
- `GET /api/reports` - Get reports (auth required)
- `DELETE /api/account` - Delete account (auth required)
- `POST /api/ai/summary` - Generate Gemini AI summary (auth required, requires GEMINI_API_KEY)

## Environment Variables

Required in `.env`:
- `GEMINI_API_KEY` - Google AI Studio API key for AI summaries

## Common Issues

- **Expired AWS credentials**: Refresh with `aws login` and update `.env`
- **Session expired**: JWT expires after 1 hour, log in again
- **Worker not processing**: Check `sudo docker compose logs worker`