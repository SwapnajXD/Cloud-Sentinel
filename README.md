# 🚀 Cloud-Sentinel

> A distributed AWS security auditing platform that scans cloud infrastructure for common security misconfigurations using an asynchronous worker architecture.

Cloud-Sentinel demonstrates production-style backend engineering concepts including queue-based processing, microservice architecture, AWS API integration, and containerized deployment.

---

## ✨ Features

### 🔒 AWS Security Audits

* Detect public S3 buckets
* Verify S3 bucket encryption
* Detect security groups open to `0.0.0.0/0`
* Check IAM user MFA
* Verify root account MFA
* List running EC2 instances

### ⚙️ Backend Architecture

* Distributed worker architecture
* Redis-based asynchronous job queue
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

Start the application:

```bash
./start.sh
```

Run the complete test flow:

```bash
./test-flow.sh
```

---

## 🔌 API

| Method | Endpoint        | Description                  |
| ------ | --------------- | ---------------------------- |
| POST   | `/api/register` | Register a new user          |
| POST   | `/api/login`    | Authenticate and receive JWT |
| POST   | `/api/audit`    | Queue an AWS audit           |
| GET    | `/api/reports`  | Retrieve audit reports       |
| GET    | `/health`       | Health check                 |

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

## 🚧 Roadmap

Planned enhancements include:

* RDS security audits
* Lambda security checks
* Scheduled audits
* Email notifications
* Dashboard analytics
* Kubernetes deployment

---

## 📄 License

This project is licensed under the MIT License.

---

⭐ If you found this project interesting, consider starring the repository.
