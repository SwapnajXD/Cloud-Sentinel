# Cloud-Sentinel: Distributed AWS Auditing Platform

## Overview

Cloud-Sentinel is a microservices-based AWS auditing platform designed to scan and monitor your AWS infrastructure for security issues. It provides a secure, scalable architecture for conducting automated AWS infrastructure audits.

---

## Architecture

Cloud-Sentinel is built with a modern microservices architecture:

```
┌─────────────┐
│   Nginx     │ ← Reverse Proxy & Rate Limiting (Port 80)
└──────┬──────┘
       │
┌──────▼────────────────────────────────────────┐
│  Node.js/Express Gateway (TypeScript)         │ (Port 3000)
│  ├─ User Management (Register/Login)          │
│  ├─ JWT Authentication                        │
│  └─ Audit Task Queueing                       │
└──────┬────────────────────────────────────────┘
       │
┌──────▼────────────────┐      ┌────────────────┐
│   Redis Task Queue    │◄────►│ Python Worker  │
│   (audit_tasks list)  │      │ (AWS Scanner)  │
└───────────────────────┘      └────────┬────────┘
                                        │
                              ┌─────────▼─────────┐
                              │  PostgreSQL DB    │
                              │ ├─ users table    │
                              │ └─ audit_reports  │
                              └───────────────────┘
```

---

## Technology Stack

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| **Gateway** | Node.js | 18-alpine | Runtime |
| **Framework** | Express.js | 4.18.2 | Web framework |
| **Language** | TypeScript | 5.1.6 | Type-safe development |
| **Authentication** | JWT + bcryptjs | 9.0.0 / 2.4.3 | Secure auth |
| **Task Queue** | Redis | 7-alpine | Async job distribution |
| **Database** | PostgreSQL | 15-alpine | Data persistence |
| **Proxy** | Nginx | 1.30-alpine | Reverse proxy |
| **Worker** | Python | 3.11-slim | AWS scanning logic |
| **AWS SDK** | boto3 | 1.26+ | AWS API access |
| **Testing** | Jest + ts-jest | 29.6.1 / 29.4.9 | Unit tests |

---

## Features

### 🔐 Security
- JWT-based authentication with 1-hour token expiration
- Password hashing with bcryptjs (12 rounds)
- Helmet.js security headers
- Express rate limiting (30 req/min on `/api/`, 60/min global)
- Proxy trust verification

### ⚡ Performance
- Asynchronous task queue with Redis BRPOP
- Non-blocking worker processing
- Connection pooling for database
- Nginx reverse proxy caching

### 📊 Reliability
- Health checks on all services (Postgres, Redis)
- Dependency management (services wait for readiness)
- Automatic database initialization on startup
- Error handling and logging with Morgan

### 🧪 Testing
- Jest tests for auth helpers (2 tests, 100% pass)
- Python unittest for worker logic (5 tests, 100% pass)
- TypeScript strict mode for compile-time safety

---

## Usage Guide

### Prerequisites

- Docker and Docker Compose
- AWS credentials (for real scans)
- Curl or Postman (for API testing)

### Quick Start

#### 1. Clone and Setup
```bash
git clone https://github.com/SwapnajXD/Cloud-Sentinel.git
cd Cloud-Sentinel
cp .env.example .env
```

#### 2. Start Services
```bash
sudo docker compose up --build -d
```

Verify services are running:
```bash
sudo docker compose ps
```

#### 3. Test Health
```bash
curl http://localhost/health
```

Expected response:
```json
{"status":"ok"}
```

---

## API Endpoints

### Health Check
```bash
GET http://localhost/health
```

### User Registration
```bash
POST http://localhost/api/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "secure-password-min-8-chars"
}
```

**Response (201 Created):**
```json
{
  "id": 1,
  "email": "user@example.com"
}
```

**Error Responses:**
- `400` - Missing email/password or password too short
- `409` - Email already registered

### User Login
```bash
POST http://localhost/api/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "secure-password-min-8-chars"
}
```

**Response (200 OK):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Token expiration:** 1 hour

### Queue Audit Task
```bash
POST http://localhost/api/audit
Content-Type: application/json
Authorization: Bearer <JWT-TOKEN>

{
  "params": {
    "scope": "default"
  }
}
```

**Response (202 Accepted):**
```json
{
  "status": "queued"
}
```

**Error Responses:**
- `401` - Missing or invalid token
- `500` - Failed to queue task

---

## Example Workflow

### Step 1: Register a User
```bash
curl -X POST http://localhost/api/register \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "auditor@company.com",
    "password": "MySecurePass123!"
  }'
```

### Step 2: Log In
```bash
curl -X POST http://localhost/api/login \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "auditor@company.com",
    "password": "MySecurePass123!"
  }'
```

Save the returned `token` value.

### Step 3: Queue an Audit
```bash
curl -X POST http://localhost/api/audit \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIs...' \
  -d '{
    "params": {
      "scope": "default"
    }
  }'
```

### Step 4: Monitor Worker Logs
```bash
sudo docker compose logs worker --follow
```

The worker will:
1. Consume the task from Redis
2. Call AWS APIs with provided credentials
3. Store results in PostgreSQL `audit_reports` table

---

## Development

### Build TypeScript
```bash
npm run build
```

Outputs to `dist/server.js`.

### Watch Mode (Development)
```bash
npm run dev
```

Automatically recompiles on file changes using ts-node.

### Run Tests
```bash
npm test
```

**Test Coverage:**
- `tests/auth.test.ts` - JWT signing and middleware validation
- `tests/test_worker.py` - AWS scanning logic and report generation

---

## Environment Variables

See `.env.example` for defaults:

```env
# Server
PORT=3000
ALLOWED_ORIGIN=*
JWT_SECRET=your-secret-key

# Database
DATABASE_URL=postgresql://postgres:postgres@db:5432/cloud_sentinel

# Redis
REDIS_URL=redis://redis:6379

# AWS (for real scans)
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
AWS_REGION=us-east-1
```

---

## Database Schema

### Users Table
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Audit Reports Table
```sql
CREATE TABLE audit_reports (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  report JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## Troubleshooting

### Gateway not responding
```bash
sudo docker compose logs gateway --tail 50
```

### Worker not processing tasks
```bash
sudo docker compose logs worker --tail 50
```

### Database connection refused
Ensure Postgres container is healthy:
```bash
sudo docker compose ps db
```

### Rebuild everything
```bash
sudo docker compose down
sudo docker system prune -f
sudo docker compose up --build
```

---

## Project Structure

```
Cloud-Sentinel/
├── server.ts              # Express gateway (TypeScript)
├── lib/
│   └── auth.ts           # JWT helpers and middleware
├── worker.py             # Python AWS scanner
├── tests/
│   ├── auth.test.ts      # Gateway tests
│   └── test_worker.py    # Worker tests
├── docker-compose.yml    # Service orchestration
├── Dockerfile.gateway    # Node.js image
├── Dockerfile.worker     # Python image
├── nginx/
│   └── nginx.conf        # Reverse proxy config
├── tsconfig.json         # TypeScript config
├── package.json          # Node dependencies
├── requirements.txt      # Python dependencies
└── README.md             # Original documentation
```

---

## Deployment Considerations

### Production Checklist
- [ ] Set strong `JWT_SECRET` in environment
- [ ] Configure AWS credentials with least-privilege IAM policy
- [ ] Use managed PostgreSQL (RDS) instead of container
- [ ] Use managed Redis (ElastiCache) instead of container
- [ ] Configure HTTPS with proper certificates
- [ ] Scale worker instances based on queue depth
- [ ] Set up CloudWatch/monitoring for audit reports
- [ ] Enable database backups and WAL archiving
- [ ] Implement audit logging for user actions

### Scaling Strategies
- Add more worker instances for parallel AWS scanning
- Use Kubernetes or ECS for container orchestration
- Add Redis cluster for high availability
- Use PostgreSQL read replicas for reporting

---

## Contributing

1. Create a feature branch
2. Make changes and test locally
3. Run `npm test` and `python -m unittest discover...`
4. Commit with descriptive messages
5. Push and create a pull request

---

## License

See LICENSE file for details.

---

## Support

For issues or questions:
1. Check logs: `sudo docker compose logs <service>`
2. Open an issue on GitHub
3. Review the conversation history in this project

---

**Last Updated:** May 6, 2026  
**TypeScript Migration:** Complete ✅
