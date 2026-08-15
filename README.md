# 🚀 Cloud-Sentinel

> A distributed AWS security auditing platform that scans cloud infrastructure for real misconfigurations, correlates them into compound risks, tracks them over time, and scores your account against a real industry benchmark.

Cloud-Sentinel demonstrates production-style backend engineering: queue-based async processing with retry/dead-letter handling, a background scheduler, account-wide security auditing, a finding-correlation engine, scan-to-scan diffing, and an honest (not fabricated) mapping to the CIS AWS Foundations Benchmark.

---

## ✨ Features

### 📋 Compliance & Risk Scoring

* Maps applicable findings to real **CIS AWS Foundations Benchmark v1.4.0**
  control IDs (root/IAM MFA, stale access keys, public S3 buckets, SSH/RDP
  exposure) - RDS and Lambda findings are deliberately left **unmapped**,
  since those services aren't part of the actual CIS Foundations Benchmark
  and forcing a mapping onto them would just be wrong
* Per-scan compliance summary (e.g. "3/5 CIS controls passing")
* A transparent, additive 0-100 risk score + letter grade per scan - no
  black-box weighting, the formula is a fixed penalty per finding severity
  and reproducible by hand

### 🧠 Correlation - compound risks, not just a flat list

A dedicated correlation engine (`worker/services/correlation.py`) looks
across the individual findings from a single scan and flags combinations
that are meaningfully worse together than either finding alone:

* An open SSH/RDP security group rule **verified** to be attached to an
  actual running, publicly-reachable instance - not just a theoretical
  exposure sitting unused
* Root account **and** at least one IAM user both missing MFA - "no MFA
  anywhere in this account," not two disconnected findings
* A stale/unused access key belonging to a user who also has no MFA - a
  forgotten credential with no second factor behind it
* The same S3 bucket or RDS instance being **both** publicly exposed and
  unencrypted
* A Lambda function that's **both** publicly invokable and running a
  deprecated runtime

Every compound finding lists exactly which underlying findings it was
built from - nothing here is inferred silently.

### 🔁 Scan diffing

Each scan is automatically compared against the user's previous one
(`worker/services/diffing.py`): new findings get tagged and badged, resolved
findings are counted, and a summary line ("3 new, 2 resolved, 4 still
outstanding") appears at the top of the report - so a scan reads as
tracking a security *posture* over time, not just a disconnected snapshot.

### 🎯 Threat Scope - an actual radar, not a decoration

The dashboard's signature visualization plots every finding as a real
blip on an interactive SVG radar: angle = resource category (S3, EC2, IAM,
RDS, Lambda, Correlated each get a fixed sector), distance from center =
severity (critical closest in, "good" findings furthest out). Click a blip
to jump straight to that finding's detail. A rotating sweep ties it back to
the login screen's ambient version of the same element.

### 🔒 AWS Security Audits

* Detect public S3 buckets; verify S3 bucket encryption
* Security groups open to `0.0.0.0/0` or `::/0` - severity depends on
  *which* ports are exposed (SSH/RDP named specifically and flagged
  critical, a wide-open range flagged medium, a standard web port like 443
  flagged low rather than treated as equally alarming)
* IAM user MFA and stale/unused access keys, checked **account-wide**
  (every IAM user, not just whichever identity happens to be running the
  scan) plus a check of the scanning identity's own MFA specifically
* Root account MFA
* Running EC2 instance inventory
* RDS public accessibility and storage encryption
* Lambda public Function URLs, public resource policies, and deprecated
  runtimes no longer receiving security patches

### ⚙️ Backend Architecture

* Distributed worker architecture (Redis queue decouples the API from
  scanning work)
* Automatic retry with backoff, then a dead-letter queue for scans that
  fail every attempt - inspectable and dismissible right from the
  dashboard, not just via raw Redis
* A background scheduler thread that polls for due recurring scans and
  enqueues them exactly like a manual scan
* Per-task status tracking (queued → running → done/error)
* JWT authentication with no insecure fallback (the gateway refuses to
  start without a real secret), endpoint-specific rate limiting, locked-down
  CORS
* Optional AI-generated plain-English summary of a report via Gemini
* PostgreSQL persistence, Dockerized deployment

---

## 🏗️ System Architecture

```text
                     ┌────────────────────┐
                     │       Browser       │
                     └──────────┬─────────┘
                                │
                                ▼
                     ┌────────────────────┐
                     │        NGINX        │
                     └──────────┬─────────┘
                                │
               ┌────────────────┴────────────────┐
               ▼                                 ▼
    ┌────────────────────┐             ┌──────────────────────┐
    │      Dashboard      │  ── fetch + JWT ──▶│       Gateway        │
    │       (Next.js)     │             │  (Node/Express, JWT)  │
    └────────────────────┘             └──────────┬───────────┘
                                                   │
                                   ┌───────────────┼────────────────┐
                                   ▼               ▼                ▼
                            ┌───────────┐  ┌──────────────┐  ┌────────────┐
                            │   Redis   │  │  PostgreSQL  │  │   Gemini   │
                            │  (queue + │  │ (users, task │  │(AI summary,│
                            │dead-letter)│ │ status, sched-│ │  optional) │
                            └─────┬─────┘  │ules, reports) │  └────────────┘
                                  │        └──────┬───────┘
                                  ▼               ▲
                          ┌───────────────┐       │
                          │     Worker    │───────┘
                          │    (Python)   │  write findings, task
                          └───────┬───────┘  status, risk score
                                  │
                                  ▼
                          ┌───────────────┐
                          │   AWS / Floci  │
                          │ S3•EC2•IAM•RDS │
                          │    •Lambda     │
                          └───────────────┘
```

The worker also runs a second, independent loop in a background thread: a
**scheduler** that polls Postgres every `SCHEDULER_POLL_SECONDS` (default
60s) for recurring scans that have come due, and pushes them onto the same
Redis queue a manually-triggered scan would use.

### Request lifecycle (a manually-triggered scan)

1. Browser calls the gateway directly with a JWT (`fetch + JWT` above -
   NGINX also proxies `/api/*`, but the dashboard's client-side calls go
   straight to the gateway).
2. Gateway validates the token, writes a `queued` row to
   `audit_tasks`, pushes the job onto Redis, and returns immediately -
   the scan itself never blocks the request.
3. The worker dequeues the job, marks it `running`, and calls AWS (via
   boto3) or Floci (a local AWS-API-compatible emulator, for safe testing)
   depending on the requested mode.
4. Individual scan modules run (S3, EC2, IAM, RDS, Lambda) and produce raw
   findings.
5. The correlation engine looks across those findings for compound risks
   and appends any it finds.
6. Findings are mapped to CIS control IDs where applicable, and the whole
   set produces a 0-100 risk score.
7. The report is diffed against the user's previous scan, tagging new
   findings and counting resolved ones.
8. The report is written to Postgres and the task is marked `done` (or
   retried with backoff, then `error`/dead-lettered, on failure).
9. The dashboard polls `GET /api/audit/:task_id` for live status, then
   reads the finished report back out via `GET /api/reports`.

### Why asynchronous processing?

A real scan against an account with many resources can take several
seconds, and AWS API calls fail intermittently for reasons that have
nothing to do with application code (throttling, transient network
issues, an expired session token). Queuing the work means the API
response is instant regardless of scan duration, and a failure gets
retried automatically instead of taking the whole request down with it.

### Scalability

The queue-based design means multiple worker replicas can consume from
the same Redis list concurrently:

```text
                 Redis
                   │
     ┌─────────────┼─────────────┐
     ▼             ▼             ▼
 Worker 1      Worker 2      Worker 3
```

### Design principles

* Separation of concerns - gateway never scans, worker never serves HTTP
* Modular scan implementation - each AWS service is its own file under
  `worker/scans/`, correlation/diffing/compliance are separate pipeline
  stages under `worker/services/`
* Queue-based asynchronous processing over synchronous request handling
* Nothing is a black box - compound findings list their sources, the risk
  score is a fixed formula, CIS mappings only appear where a real control
  applies

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
| POST   | `/api/ai/summary`     | Get a plain-English summary of a report (requires `GEMINI_API_KEY`) |
| DELETE | `/api/account`        | Delete account (password-confirmed) |
| GET    | `/health`             | Health check                 |

---

## 📁 Project Structure

```text
Cloud-Sentinel/
├── dashboard/          # Next.js frontend
│   └── components/
│       ├── scope/      # ThreatScope - the radar visualization
│       ├── dashboard/
│       └── sentinel/    # Login-page radar sweep
├── gateway/            # Node.js API Gateway
│   └── src/
│       ├── app.ts       # Express app (importable, no side effects)
│       └── server.ts    # Thin entrypoint (connects, listens)
├── worker/             # Python audit worker
│   ├── scans/          # One file per AWS service
│   └── services/
│       ├── audit.py       # Orchestrates a scan end to end
│       ├── compliance.py  # CIS mapping + risk score
│       ├── correlation.py # Compound-risk detection
│       └── diffing.py     # Scan-to-scan diffing
├── tests/              # Gateway (supertest) + worker (unittest) suites
├── nginx/
├── infra/
├── docs/
└── docker-compose.yml
```

---

## 📚 Documentation

Further documentation is available in the `docs/` directory.

* 🔌 `docs/API.md`
* ☁️ `docs/AWS.md`
* 🗄️ `docs/DATABASE.md`
* 🚀 `docs/DEPLOYMENT.md`
* 🛠️ `docs/TROUBLESHOOTING.md`

---

## 🔐 Security

* AWS credentials are **never committed** to the repository.
* Credentials are exported dynamically at runtime using the AWS CLI.
* Protected endpoints use **JWT authentication** - the gateway refuses to
  start without a real, configured secret (no insecure default).
* Auth endpoints (`/api/register`, `/api/login`) have a dedicated, tighter
  rate limit than general API traffic.
* Audit reports, schedules, and dead-letter entries are isolated per
  authenticated user.

---

## ⚠️ Known Limitations

* Task retries use a fixed delay, not exponential backoff.
* No account lockout after repeated failed logins beyond the 10-req/15-min
  rate limit on `/api/login`.
* AWS scan modules cover S3, EC2, IAM, RDS, and Lambda; see the roadmap
  below for planned additions (CloudTrail, IAM password policy).
* The correlation engine covers a fixed set of hand-written rules, not a
  general-purpose graph analysis - it catches real, specific compound
  risks well, but isn't exhaustive.

---

## 🚧 Roadmap

Planned enhancements include:

* CloudTrail-enabled and IAM account password policy checks
* Email/webhook notifications on scan completion
* Terraform/IaC scanning before deployment (shift-left)
* Multi-account scanning
* Kubernetes deployment

---

## 📄 License

This project is licensed under the MIT License.

---

⭐ If you found this project interesting, consider starring the repository.
