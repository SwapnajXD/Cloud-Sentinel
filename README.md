# Cloud-Sentinel

A self-hosted, single-owner AWS security auditing console. A Node.js gateway
records scan jobs in PostgreSQL, a Python worker inspects AWS configuration,
and a Next.js dashboard presents scoped findings and reports.

## Features

- Select an AWS connection, region, and services for manual or scheduled scans.
- Inspect S3 public access and encryption, EC2 security-group ingress, IAM MFA
  and unused access keys, RDS exposure and encryption, and Lambda access and runtimes.
- Keep explicit `PASS`, `FAIL`, `UNKNOWN`, and `SKIPPED` evidence. Incomplete
  scans produce partial reports with provisional scores.
- Track durable jobs with progress, renewable leases, retries with backoff,
  and failed-job inspection and dismissal.
- Compare reports for matching accounts and scope; inspect findings, export
  JSON, print reports, and optionally request Gemini interpretation.
- Connect additional AWS accounts through AssumeRole and an External ID.
- Use database-enforced single-owner registration and one-hour JWT sessions.

Scores cover observed checks only: start at 100 and deduct 15 per critical,
5 per medium, and 1 per low failed check, floored at zero. Higher is better.
Correlated findings do not add duplicate penalties. Selected checks map to
CIS AWS Foundations Benchmark v1.4.0; this is not a complete benchmark assessment.

## Architecture

```text
Browser → NGINX → Next.js dashboard
              └→ Express gateway → PostgreSQL (jobs, reports, configuration)
                                └→ Redis (optional worker wakeups)
                    Python worker ↔ PostgreSQL
                                  → AWS APIs / Floci emulator
```

PostgreSQL is the durable queue. Redis notifications reduce dispatch latency;
the worker can recover queued work by polling PostgreSQL when Redis is unavailable.
See [Architecture](docs/ARCHITECTURE.md) for leases, retries, and scheduling.

## Quick start

Install Docker with Compose v2. Use an AWS CLI profile or a workload IAM role
for real AWS scans. Run these commands from the repository root:

```bash
git clone https://github.com/SwapnajXD/Cloud-Sentinel.git
cd Cloud-Sentinel
cp infra/.env.example infra/.env
openssl rand -hex 32
openssl rand -hex 32
```

Set `JWT_SECRET` and `POSTGRES_PASSWORD` in `infra/.env` to the two separately
generated values. The JWT secret must have at least 32 characters.

To use your AWS console login credentials and launch (AWS CLI v2 required):

```bash
aws login
./start.sh
```

This writes credentials to the ignored `.aws.env` file with private file
permissions on every start. If export fails, the script runs `aws login` and
retries. Use `AWS_PROFILE=my-profile ./start.sh` for a named profile. Rerun
`./start.sh` when temporary container credentials expire; they do not refresh
inside the running container. To use an existing `.aws.env` or a workload IAM
role, launch with `./start.sh --skip-aws-refresh`.

Open **http://localhost:8080** and create the owner account. Registration
closes after that account exists. Passwords require at least 12 characters
and at most 72 UTF-8 bytes. `SINGLE_USER_MODE=false` is no longer supported.

For a forgotten password on a running Compose installation:

```bash
python3 scripts/reset_owner_password.py owner@example.com
```

The command privately prompts for a new password. See
[Owner password recovery](docs/DEPLOYMENT.md#owner-password-recovery) for
requirements, sudo usage, and session behavior.

## Development and tests

See [Deployment](docs/DEPLOYMENT.md#local-development) for dependency setup
and `./dev.sh`. After installing dependencies:

```bash
npm test --prefix gateway
.venv/bin/python -m unittest discover -s tests -p test_worker.py
python3 -m unittest discover -s tests -p test_password_reset.py
```

[Testing](docs/TESTING.md) covers type checks, production builds, and isolated
PostgreSQL integration tests.

## Project structure

```text
Cloud-Sentinel/
├── dashboard/           # Next.js console and development API proxy
├── gateway/             # Express API and shared SQL migrations
├── worker/              # Python worker, scan modules, report services
├── scripts/             # Private owner password recovery
├── tests/               # Gateway, worker, recovery, and database tests
├── nginx/               # Reverse proxy configuration
├── infra/               # Compose files, environment example, IAM templates
├── docs/
├── start.sh             # Container launch and explicit credential refresh
└── dev.sh               # Local gateway, worker, and dashboard processes
```

## Documentation

- [Console and developer guide](docs/GUIDE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [API reference](docs/API.md)
- [AWS checks and connections](docs/AWS.md)
- [Database and migrations](docs/DATABASE.md)
- [Deployment and password recovery](docs/DEPLOYMENT.md)
- [Testing](docs/TESTING.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## Deployment scope and limitations

This is a personal tool with one owner; that owner can connect multiple AWS
accounts. The database enforces this access model. The default deployment
binds to loopback and serves HTTP. Configure TLS and appropriate access
controls before exposing it beyond your machine.

AWS scans inspect selected configuration, not end-to-end network reachability.
IAM is account-wide; S3 inventories buckets across their actual regions;
EC2, RDS, and Lambda use the selected region. Unknown or skipped evidence
does not establish a pass, and a high score does not establish full coverage.
Lambda runtime checks depend on the worker's maintained runtime table.

Passwords are bcrypt-hashed; authentication attempts are rate-limited. Owner
password recovery requires terminal and container access. There is no public
password-reset endpoint or email recovery flow. Optional AI interpretation
sends the selected report to Gemini only when requested from the console.
