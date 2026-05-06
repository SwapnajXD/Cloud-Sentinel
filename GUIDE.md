# Cloud-Sentinel: Distributed AWS Auditing Platform

## Overview

Cloud-Sentinel is a microservices-based AWS auditing platform designed to scan and monitor your AWS infrastructure for security issues. It provides a secure, scalable architecture for conducting automated AWS infrastructure audits with a modern web dashboard and powerful REST API.

---

## Architecture

Cloud-Sentinel is built with a modern microservices architecture:

```
                    ┌─────────────────────────────────┐
                    │   Next.js Dashboard (Port 3001)  │
                    │   (React UI + API Proxy)         │
                    └────────────────┬──────────────────┘
                                     │
┌─────────────┐                      │
│   Nginx     │◄─────────────────────┘
│ (Port 80)   │
└──────┬──────┘
       │
┌──────▼────────────────────────────────────────┐
│  Node.js/Express Gateway (TypeScript)         │ (Port 3000)
│  ├─ User Management (Register/Login)          │
│  ├─ JWT Authentication & Middleware           │
│  ├─ Audit Task Queueing to Redis              │
│  └─ Report Retrieval & Account Management     │
└──────┬────────────────────────────────────────┘
       │
       ├────────────────────────┬────────────────┐
       │                        │                │
┌──────▼────────────────┐   ┌───▼────────────┐  │
│   Redis Task Queue    │   │ PostgreSQL DB  │  │
│   (audit_tasks list)  │   │ ├─ users       │  │
└──────┬────────────────┘   │ └─ audit_       │  │
       │                    │   reports      │  │
       │                    └────────────────┘  │
       │                                       │
┌──────▼─────────────────────────────────────┐ │
│  Python Worker (AWS Scanner)               │ │
│  ├─ Reads tasks from Redis BRPOP           │ │
│  ├─ AWS API calls (boto3)                  │ │
│  │  ├─ S3 bucket encryption scan           │ │
│  │  ├─ EC2 instance inventory              │ │
│  │  └─ IAM user MFA status check           │ │
│  └─ Writes reports to PostgreSQL ─────────┼─┘
└────────────────────────────────────────────┘
```

---

## Technology Stack

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| **Dashboard** | Next.js | 14.2.31 | Web UI & API proxy |
| **Framework** | React | 18.3.1 | UI components |
| **Gateway** | Node.js | 18-alpine | Runtime |
| **Framework** | Express.js | 4.18.2 | Web framework |
| **Language** | TypeScript | 5.1.6 | Type-safe development |
| **Authentication** | JWT + bcryptjs | 9.0.0 / 2.4.3 | Secure auth & hashing |
| **Task Queue** | Redis | 7-alpine | Async job distribution |
| **Database** | PostgreSQL | 15-alpine | Data persistence |
| **Proxy** | Nginx | 1.30-alpine | Reverse proxy & routing |
| **Worker** | Python | 3.11-slim | AWS scanning logic |
| **AWS SDK** | boto3 | 1.26+ | AWS API access |
| **Testing** | Jest + ts-jest | 29.6.1 / 29.4.9 | Unit tests |

---

## Features

### 🔐 Security
- JWT-based authentication with 1-hour token expiration
- Password hashing with bcryptjs (12 rounds)
- Helmet.js security headers on gateway
- Express rate limiting (60 req/min)
- Session expiration handling on dashboard
- Proxy trust verification

### ⚡ Performance
- Asynchronous task queue with Redis BRPOP
- Non-blocking worker processing
- Connection pooling for database
- Nginx reverse proxy with proper routing
- Next.js standalone build for minimal overhead

### 📊 Reliability
- Health checks on all services (Postgres, Redis)
- Dependency management (services wait for readiness)
- Automatic database initialization on startup
- Error handling and logging with Morgan
- Worker error recovery with retry logic

### 🧪 Testing
- Jest tests for auth helpers (2 tests)
- Python unittest for worker logic (5 tests)
- Terminal-based end-to-end test script
- TypeScript strict mode for compile-time safety

---

## Setup & Installation

### Prerequisites

- Docker and Docker Compose
- AWS credentials (IAM user with S3, EC2, IAM read permissions)
- Curl or Postman (for API testing)

### Step 1: Clone & Configure

```bash
git clone https://github.com/SwapnajXD/Cloud-Sentinel.git
cd Cloud-Sentinel
cp .env.example .env
```

### Step 2: Configure AWS Credentials

```bash
# Log in with AWS SSO/Login
aws login

# Export credentials to environment
eval $(aws configure export-credentials --format env)

# Display the credentials
echo "AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID"
echo "AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY"
echo "AWS_SESSION_TOKEN=$AWS_SESSION_TOKEN"
echo "AWS_REGION=ap-south-1"
```

### Step 3: Update .env File

Edit `.env` and add the AWS credentials from step 2:

```env
PORT=3000
DATABASE_URL=postgres://postgres:postgres@db:5432/cloud_sentinel
REDIS_URL=redis://redis:6379
JWT_SECRET=your-secure-secret-key-change-me
ALLOWED_ORIGIN=
AWS_ACCESS_KEY_ID=ASIA...
AWS_SECRET_ACCESS_KEY=...
AWS_SESSION_TOKEN=IQoJb3JpZ2luX2VjE...
AWS_REGION=ap-south-1
```

### Step 4: Start Services

```bash
sudo docker compose up --build -d
```

Verify all services are running:

```bash
sudo docker compose ps
```

Expected output:
```
NAME                     IMAGE                          STATUS
cloud-sentinel-dashboard cloud-sentinel-dashboard:latest Up
cloud-sentinel-gateway   cloud-sentinel-gateway:latest  Up
cloud-sentinel-worker    cloud-sentinel-worker:latest   Up
cloud-sentinel-redis     redis:7-alpine                 Up
cloud-sentinel-db        postgres:15-alpine             Up
cloud-sentinel-nginx     nginx:stable-alpine            Up
```

### Step 5: Test Health

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

**Response (200 OK):**
```json
{"status":"ok"}
```

---

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
- `400` - Missing email/password or password too short (< 8 chars)
- `409` - Email already registered
- `500` - Internal server error

---

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
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwiZW1haWwiOiJ1c2VyQGV4YW1wbGUuY29tIiwiaWF0IjoxNzc4MDkxMTA0LCJleHAiOjE3NzgwOTQ3MDR9.UE2WzGIylkalM2CYK3KIwQggN6mstYDxaE4LLSCjfJA"
}
```

**Token expiration:** 1 hour

**Error Responses:**
- `400` - Missing email/password
- `401` - Invalid credentials
- `500` - Internal server error

---

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

### Get Audit Reports
```bash
GET http://localhost/api/reports?limit=50&offset=0
Authorization: Bearer <JWT-TOKEN>
```

**Response (200 OK):**
```json
{
  "reports": [
    {
      "id": 1,
      "report": {
        "task_id": null,
        "action": "start_audit",
        "user_id": 1,
        "requested_at": "2026-05-06T18:19:01.984Z",
        "scan": {
          "unencrypted_s3_buckets": [],
          "running_ec2_instances": [],
          "mfa": {
            "enabled": false,
            "status": "disabled",
            "user_name": "dops"
          }
        }
      },
      "created_at": "2026-05-06T18:19:03.957Z"
    }
  ],
  "count": 1
}
```

**Query Parameters:**
- `limit` - Number of reports to return (default: 50, max: 500)
- `offset` - Pagination offset (default: 0)

**Error Responses:**
- `401` - Missing or invalid token
- `500` - Database error

---

### Delete Account
```bash
DELETE http://localhost/api/account
Content-Type: application/json
Authorization: Bearer <JWT-TOKEN>

{
  "password": "user-password"
}
```

**Response (200 OK):**
```json
{
  "message": "account deleted successfully"
}
```

**Error Responses:**
- `400` - Missing password
- `401` - Invalid password or missing token
- `500` - Database error

---

## Complete Workflow

### Using the Terminal Test Script

The easiest way to test the entire pipeline:

```bash
./test-flow.sh
```

This script:
1. Registers a new user
2. Logs in with provided credentials
3. Queues an audit task
4. Waits 5 seconds for worker processing
5. Fetches and displays reports

Example output:
```
=== Cloud-Sentinel Test Flow ===

1. Registering user...
Response: {"id":4,"email":"test@example.com"}

2. Logging in...
Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

3. Queuing audit task...
Response: {"status":"queued"}

4. Waiting 5 seconds for worker to process...

5. Fetching reports...
Reports found: 1

6. Test Summary:
✅ SUCCESS: Audit report was created and stored!
```

### Manual Step-by-Step

**Step 1: Register a User**
```bash
curl -X POST http://localhost/api/register \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "auditor@company.com",
    "password": "MySecurePass123!"
  }'
```

**Step 2: Log In**
```bash
curl -X POST http://localhost/api/login \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "auditor@company.com",
    "password": "MySecurePass123!"
  }' | jq '.token' -r
```

Save the token in a variable:
```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**Step 3: Queue an Audit**
```bash
curl -X POST http://localhost/api/audit \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "params": {
      "scope": "default"
    }
  }'
```

**Step 4: Monitor Worker Processing**
```bash
sudo docker compose logs -f worker
```

Expected output:
```
worker-1  | Worker started, listening for audit_tasks...
worker-1  | DEBUG: AWS_KEY=ASIA...
worker-1  | DEBUG: AWS_SECRET=...
worker-1  | DEBUG: AWS_TOKEN=PRESENT
worker-1  | DEBUG: AWS_REGION=ap-south-1
worker-1  | Processed task: ok 1
```

**Step 5: Fetch Reports**
```bash
curl http://localhost/api/reports \
  -H "Authorization: Bearer $TOKEN" | jq .
```

---

## Development

### Build TypeScript
```bash
npm run build
```

Outputs to `dist/server.js`.

### Watch Mode
```bash
npm run dev
```

Automatically recompiles on file changes using ts-node and nodemon.

### Run Tests

**Gateway tests:**
```bash
npm test
```

**Worker tests:**
```bash
python -m unittest discover tests -p "test_*.py" -v
```

---

## Monitoring & Logs

### View All Logs
```bash
sudo docker compose logs -f
```

### View Specific Service Logs
```bash
# Gateway
sudo docker compose logs -f gateway

# Worker
sudo docker compose logs -f worker

# Database
sudo docker compose logs -f db

# Redis
sudo docker compose logs -f redis
```

### Check Container Status
```bash
sudo docker compose ps
```

### Inspect Live Environment
```bash
# Check worker environment variables
sudo docker compose exec worker sh -lc 'env | grep ^AWS'

# Check database connectivity
sudo docker compose exec gateway pg_isready -h db

# Check Redis connectivity
sudo docker compose exec gateway redis-cli -h redis ping
```

---

## Database Schema

### Users Table
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,        -- bcrypt hash
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Audit Reports Table
```sql
CREATE TABLE audit_reports (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id TEXT,
  report JSONB NOT NULL,          -- Contains scan results
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Audit Report JSON Structure
```json
{
  "task_id": null,
  "action": "start_audit",
  "user_id": 1,
  "requested_at": "2026-05-06T18:19:01.984Z",
  "scan": {
    "unencrypted_s3_buckets": [
      {
        "bucket": "my-bucket",
        "encrypted": false,
        "details": "No bucket encryption configuration found"
      }
    ],
    "running_ec2_instances": [
      {
        "instance_id": "i-1234567890abcdef0",
        "state": "running",
        "type": "t2.micro",
        "public_ip": "52.1.2.3"
      }
    ],
    "mfa": {
      "enabled": true,
      "status": "enabled",
      "user_name": "dops"
    }
  }
}
```

---

## Troubleshooting

### Gateway not responding
```bash
sudo docker compose logs gateway --tail 50
```

Look for:
- Database connection issues
- Redis connection issues
- JWT secret mismatch

### Worker not processing tasks
```bash
sudo docker compose logs worker --tail 50
```

Common issues:
- Expired AWS credentials (`ExpiredToken` error)
- Missing AWS environment variables
- Database connection refused
- Redis connection refused

**Solution:** Refresh AWS credentials and restart worker:
```bash
aws login
eval $(aws configure export-credentials --format env)
# Update .env file with new credentials
sudo docker compose up -d --build worker
```

### Database connection refused
```bash
sudo docker compose ps db
```

Ensure the database container is healthy. Restart if needed:
```bash
sudo docker compose restart db
```

### Session expired errors (401) on dashboard
This is expected after 1 hour. Simply log in again. The dashboard automatically clears expired tokens.

### Rebuild everything from scratch
```bash
sudo docker compose down -v
sudo docker system prune -f
sudo docker compose up --build -d
```

The `-v` flag removes volumes (database data will be lost).

---

## Project Structure

```
Cloud-Sentinel/
├── dashboard/                    # Next.js frontend
│   ├── app/
│   │   ├── page.tsx            # Main page
│   │   ├── layout.tsx          # Layout wrapper
│   │   ├── globals.css         # Global styles
│   │   └── api/[...path]/      # API proxy handler
│   ├── components/
│   │   └── dashboard-shell.tsx # Main dashboard component
│   ├── Dockerfile              # Next.js build & runtime
│   └── package.json
├── server.ts                    # Express gateway (TypeScript)
├── lib/
│   └── auth.ts                 # JWT helpers and middleware
├── worker.py                    # Python AWS scanner
├── tests/
│   ├── auth.test.ts            # Gateway auth tests
│   └── test_worker.py          # Worker tests
├── docker-compose.yml          # Service orchestration
├── Dockerfile.gateway          # Node.js gateway image
├── Dockerfile.worker           # Python worker image
├── nginx/
│   └── nginx.conf              # Reverse proxy config
├── tsconfig.json               # TypeScript configuration
├── package.json                # Node dependencies
├── requirements.txt            # Python dependencies
├── test-flow.sh                # End-to-end test script
├── .env.example                # Example environment file
└── README.md                   # Quick start guide
```

---

## Deployment Considerations

### Production Checklist
- [ ] Set strong `JWT_SECRET` (use `openssl rand -base64 32`)
- [ ] Configure AWS credentials with least-privilege IAM policy
- [ ] Use managed PostgreSQL (AWS RDS) instead of container
- [ ] Use managed Redis (AWS ElastiCache) instead of container
- [ ] Configure HTTPS with proper SSL certificates
- [ ] Scale worker instances based on queue depth
- [ ] Set up CloudWatch for monitoring
- [ ] Enable database backups and WAL archiving
- [ ] Implement audit logging for user actions
- [ ] Rate limit by user, not globally
- [ ] Use environment-specific .env files

### Scaling Strategies
1. **Horizontal Worker Scaling**: Add multiple worker containers
   ```bash
   sudo docker compose up -d --scale worker=5
   ```

2. **Database Optimization**:
   - Add read replicas for report queries
   - Index on `user_id` and `created_at`
   - Archive old reports periodically

3. **Redis Optimization**:
   - Use Redis Cluster for high availability
   - Monitor queue depth
   - Configure persistence for critical tasks

4. **Container Orchestration**:
   - Migrate to Kubernetes or ECS
   - Use auto-scaling groups
   - Configure health checks and restarts

---

## AWS Credential Management

### Using aws login (Recommended)

The most secure method for development:

```bash
# Initial setup
aws login

# Use credentials in current session
eval $(aws configure export-credentials --format env)

# Add to .env for worker
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_REGION
```

### Using IAM Access Keys (Development Only)

Create an IAM user with S3, EC2, and IAM read-only permissions:

```bash
aws iam create-access-key --user-name auditor-service
```

Add to `.env`:
```env
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=ap-south-1
```

### Required IAM Permissions

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListAllMyBuckets",
        "s3:GetBucketEncryption"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "iam:GetUser",
        "iam:ListMFADevices"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "sts:GetCallerIdentity"
      ],
      "Resource": "*"
    }
  ]
}
```

---

## Contributing

1. Create a feature branch (`git checkout -b feature/amazing-feature`)
2. Make changes and test locally (`npm test`, `python -m unittest`)
3. Commit with descriptive messages (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

MIT License - see LICENSE file for details

---

**Last Updated:** May 6, 2026  
**Status:** ✅ Production Ready  
**Test Coverage:** 7 tests (Gateway: 2, Worker: 5)

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

**Last Updated:** May 6, 2026  
