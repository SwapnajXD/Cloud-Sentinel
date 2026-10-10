# Offline demo data

`worker/demo_data.py` generates two fictional reports without AWS credentials,
an AWS account, Floci, or network access. They share one scope so the dashboard
shows a score trend and resolved findings. The latest report includes passing
and failing CIS controls, a potential EC2 administrative exposure path, unknown
Lambda evidence, and S3/RDS/IAM examples. The account number `000000000000`,
resource names, reserved example IP, report notes, and console notices identify
the data as fictional. This is a product demonstration, not scan evidence.

To inspect the data as JSON without running any service:

```bash
.venv/bin/python worker/demo_data.py --output /tmp/cloud-sentinel-demo.json
```

To view it in a local dashboard, configure `infra/.env` as in the
[quick start](../README.md#quick-start), then start the Compose stack without
an AWS login. Create the single owner through the UI before seeding. The
command connects only to the Compose PostgreSQL database; it does not call
AWS or queue worker scans.

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml up -d --build
docker compose --env-file infra/.env -f infra/docker-compose.yml exec worker python demo_data.py --seed
```

Select **All accounts** or **Worker identity** in the account filter, then open
**Reports**, **Findings**, **Compliance**, and **Overview**. The reports
also support the normal offline HTML, sanitized JSON, and SARIF export buttons.
The policy editor can evaluate a rule against either demo report; for example,
the following matches the fictional public S3 bucket finding:

```yaml
apiVersion: cloud-sentinel/v1
kind: Policy
metadata:
  name: demo-public-s3
  version: 1
  description: Find public S3 access in stored findings
spec:
  resource: finding
  filters:
    - field: type
      op: equals
      value: S3PublicAccess
    - field: status
      op: equals
      value: FAIL
  severity: critical
  remediation: Remove public access from the bucket policy.
```

Seeding twice is safe: stable demo task IDs prevent duplicates. The command
does not modify existing real reports. To remove only these two demo reports
and their completed demo task records:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml exec worker python demo_data.py --remove
```

Saved policies are independent and are not removed by this command.
