# 🚀 Cloud-Sentinel

> A distributed AWS security auditing platform that scans cloud infrastructure for common security misconfigurations using an asynchronous worker architecture.

Cloud-Sentinel demonstrates production-style backend engineering concepts including queue-based processing, microservice architecture, AWS API integration, and containerized deployment.

---

## ✨ Features

### 📋 Compliance & Risk Scoring

* Maps applicable findings to real **CIS AWS Foundations Benchmark v1.4.0**
  control IDs (root/IAM MFA, stale access keys, public S3 buckets, SSH/RDP
  exposure) - RDS and Lambda findings are deliberately left unmapped since
  they aren't part of the actual CIS Foundations Benchmark
* Per-scan compliance summary (e.g. "3/5 CIS controls passing")
* A transparent, additive 0-100 risk score + letter grade per scan (no
  black-box weighting - the formula is a fixed penalty per finding severity,
  easy to reproduce by hand)

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
* Cross-account scanning: other users can connect their own AWS account via
  a read-only IAM role (AssumeRole + External ID, no long-lived credentials
  ever stored) - see `infra/cloudformation/`. Fully opt-in; a deployment
  with none of this configured keeps scanning via its own static credentials
  exactly as before.
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
| POST   | `/api/aws-connections` | Connect an AWS account (role ARN + External ID) |
| GET    | `/api/aws-connections` | List connected AWS accounts  |
| DELETE | `/api/aws-connections/:id` | Disconnect an AWS account |
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

## 🔐 Security & Deployment Posture

### Default: single-user, personal use — and safe as such

**This app defaults to single-user mode (`SINGLE_USER_MODE=true`).** Registration
closes itself automatically after the first account is created, so cloning
this repo and running it gives you a personal security-scanning tool on
your own infrastructure - not an accidentally-exposed multi-tenant service.
In this mode:

* AWS credentials for your own account are **never committed** to the
  repository and are exported dynamically at runtime using the AWS CLI.
* Protected endpoints use **JWT authentication** with no insecure fallback -
  the gateway refuses to start without a real `JWT_SECRET`.
* You can still connect **additional AWS accounts you personally own**
  (e.g. a homelab account plus a work account) via the cross-account
  AssumeRole flow below - that's just you, using temporary credentials
  instead of static ones, and is safe under this default.

### Cross-account connections (AssumeRole) - the mechanism is sound, exposing it to strangers is not (yet)

The AssumeRole implementation itself follows the AWS-recommended pattern
correctly:

* **Temporary, auto-expiring credentials only** (`sts:AssumeRole`, 1-hour
  sessions) - Cloud-Sentinel never sees or stores anyone's long-lived
  access keys for a connected account.
* **External ID required** on every assume-role call, mitigating the
  "confused deputy" problem.
* **Least-privilege, read-only policy** on the connected role - see
  `infra/cloudformation/cloud-sentinel-scan-role.yaml` for the exact
  action list, generated by enumerating every AWS API call the scan
  modules actually make. No write access, ever.
* **Least-privilege on this side too** - the worker's own IAM identity
  (in your AWS account) should be scoped to *only* `sts:AssumeRole` on
  roles matching the Cloud-Sentinel naming convention, never given broad
  permissions of its own. See `infra/cloudformation/worker-identity-policy.json`.
  This matters because if the worker box itself were ever compromised, an
  attacker should gain nothing beyond "can assume already-read-only
  connected roles" - not your own account's permissions too.

**What's still missing before this should ever be exposed to people you
don't personally trust** (i.e. before setting `SINGLE_USER_MODE=false`):

* **No TLS.** nginx has no HTTPS termination configured. JWTs and role
  ARNs would travel in plaintext over an open connection - this alone
  blocks any public deployment.
* **No email verification on registration** - fine when you're the only
  possible user; not fine once strangers can create accounts.
* **App-level tenant isolation only.** All users share one Postgres
  database, isolated by `user_id` checks in application code. A single
  authorization bug would expose every connected user's role ARN and
  External ID to every other user, not just their own. Real multi-tenant
  isolation would need defense in depth beyond query-level `WHERE user_id = $1`.
* **No abuse limits specific to connection creation**, and no visible
  access log showing a connected user exactly when their account was
  scanned and what was read.

If you want to take this further into genuine multi-tenant territory, that
list is the actual work, in roughly that priority order - not new scan
checks or UI polish.

---

## ⚠️ Known Limitations

* Task retries use a fixed delay (no exponential backoff).
* No account lockout after repeated failed logins beyond the 10-req/15-min
  rate limit on `/api/login`.
* The S3 public-access check only looks at bucket ACLs, not bucket
  policies - a bucket made public purely via policy (no public ACL grant)
  won't currently be flagged.
* Manually scanning a specific connected account (when more than one is
  connected) isn't in the UI yet - scans currently default to the first
  connected account.

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
