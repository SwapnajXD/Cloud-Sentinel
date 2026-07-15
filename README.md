# 🚀 Cloud-Sentinel

> A distributed AWS security auditing platform that scans cloud infrastructure for common security misconfigurations using an asynchronous worker architecture.

Cloud-Sentinel demonstrates production-style backend engineering concepts including queue-based processing, microservice architecture, AWS API integration, and containerized deployment.

---

## ✨ Features

### 🔒 AWS Security Audits

* Detect public S3 buckets
* Verify S3 bucket encryption
* Detect security groups open to `0.0.0.0/0`
* Check IAM user MFA (both the scanning identity and account-wide, every IAM user)
* Verify root account MFA
* Flag unused or stale IAM access keys (account-wide, every IAM user)
* List running EC2 instances
* Detect publicly accessible RDS instances
* Verify RDS storage encryption
* Detect publicly invokable Lambda functions (public Function URLs or resource policies)
* Flag Lambda functions on deprecated runtimes

### ⚙️ Backend Architecture

* Distributed worker architecture
* Redis-based asynchronous job queue with retry + dead-letter handling
* Dead-letter queue inspection and dismissal from the dashboard
* Recurring/scheduled scans (hourly-granularity intervals, 1h-1 week)
* Per-task status tracking (queued → running → done/error)
* JWT authentication
* PostgreSQL persistence
* Dockerized deployment

---

## 🏗️ System Architecture

```text
                Client
                   │
                   ▼
                NGINX
                   │
                   ▼
        Gateway (Node.js/Express)
                   │
                   ▼
             Redis Queue
                   │
                   ▼
          Worker (Python/boto3)
                   │
          ┌────────┴────────┐
          ▼                 ▼
      AWS APIs         PostgreSQL
          │                 ▲
          └────────┬────────┘
                   ▼
           Next.js Dashboard
```

---

## 🛠️ Tech Stack

| Layer          | Technology           |
| -------------- | -------------------- |
| Frontend       | Next.js + TypeScript |
| Backend        | Node.js + Express    |
| Worker         | Python + boto3       |
| Queue          | Redis                |
| Database       | PostgreSQL           |
| Infrastructure | Docker + NGINX       |

---

## 🚀 Quick Start

Clone the repository:

```bash
git clone https://github.com/YOUR_USERNAME/cloud-sentinel.git
cd cloud-sentinel
```

Authenticate with AWS:

```bash
aws login
```

Set up your environment file (required - the gateway won't start without a
`JWT_SECRET`):

```bash
cp infra/.env.example infra/.env
# then edit infra/.env and fill in JWT_SECRET, ALLOWED_ORIGIN, etc.
```

Start the application:

```bash
./start.sh
```

Run the tests:

```bash
cd gateway && npm test
cd ../worker && python -m unittest discover -s ../tests -p "test_worker.py"
```

---

## 🔌 API

| Method | Endpoint             | Description                  |
| ------ | --------------------- | ---------------------------- |
| POST   | `/api/register`       | Register a new user          |
| POST   | `/api/login`          | Authenticate and receive JWT |
| POST   | `/api/audit`          | Queue an AWS audit           |
| GET    | `/api/audit/:task_id` | Check audit task status      |
| GET    | `/api/reports`        | Retrieve audit reports       |
| POST   | `/api/schedules`      | Create a recurring scan      |
| GET    | `/api/schedules`      | List recurring scans         |
| DELETE | `/api/schedules/:id`  | Cancel a recurring scan      |
| GET    | `/api/dead-letter`    | List scans that failed all retries |
| DELETE | `/api/dead-letter/:task_id` | Dismiss a dead-lettered scan |
| DELETE | `/api/account`        | Delete account (password-confirmed) |
| GET    | `/health`             | Health check                 |

---

## 📁 Project Structure

```text
Cloud-Sentinel/
├── dashboard/          # Next.js frontend
├── gateway/            # Node.js API Gateway
├── worker/             # Python audit worker
│   ├── scans/
│   └── services/
├── nginx/
├── infra/
├── docs/
└── docker-compose.yml
```

---

## 📚 Documentation

Detailed documentation is available in the `docs/` directory.

* 📘 `docs/GUIDE.md`
* 🏗️ `docs/ARCHITECTURE.md`
* 🔌 `docs/API.md`
* ☁️ `docs/AWS.md`
* 🗄️ `docs/DATABASE.md`
* 🚀 `docs/DEPLOYMENT.md`
* 🛠️ `docs/TROUBLESHOOTING.md`

---

## 🔐 Security

* AWS credentials are **never committed** to the repository.
* Credentials are exported dynamically at runtime using the AWS CLI.
* Protected endpoints use **JWT authentication**.
* Audit reports are isolated per authenticated user.

---

## ⚠️ Known Limitations

* Task retries use a fixed delay (no exponential backoff) and there's no UI
  for inspecting the `audit_tasks_dead` dead-letter queue yet - that requires
  manual Redis inspection.
* No account lockout after repeated failed logins beyond the 10-req/15-min
  rate limit on `/api/login`.
* AWS scan modules cover S3, EC2, IAM, and RDS only; see the roadmap below
  for planned additions.

---

## 🚧 Roadmap

Planned enhancements include:

* Email notifications
* Dashboard analytics
* Kubernetes deployment

---

## 📄 License

This project is licensed under the MIT License.

---

⭐ If you found this project interesting, consider starring the repository.
