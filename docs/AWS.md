# ☁️ AWS Audit Engine

This document explains how Cloud-Sentinel interacts with AWS, which services are currently supported, and how new security checks can be added.

---

# Overview

The Worker service uses the AWS SDK for Python (`boto3`) to inspect AWS resources and identify common security misconfigurations.

Each AWS service has its own scan module, making the audit engine modular and easy to extend.

Current supported services:

* Amazon S3
* Amazon EC2
* AWS IAM

---

# Scan Architecture

```text
worker/
├── scans/
│   ├── s3.py
│   ├── ec2.py
│   └── iam.py
│
└── services/
    └── audit.py
```

* Each scan module is responsible for a single AWS service.
* `audit.py` executes all scans and combines the results into a single report.

---

# Audit Workflow

```text
Worker
   │
   ▼
Create boto3 clients
   │
   ▼
Run S3 Scan
   │
   ▼
Run EC2 Scan
   │
   ▼
Run IAM Scan
   │
   ▼
Merge Findings
   │
   ▼
Store Report in PostgreSQL
```

---

# Amazon S3 Checks

**Module**

```text
worker/scans/s3.py
```

Current checks:

* Detect public buckets
* Detect buckets without server-side encryption

Example finding:

```json
{
  "type": "S3PublicAccess",
  "severity": "critical",
  "resource": "example-bucket",
  "details": "Bucket is publicly accessible"
}
```

---

# Amazon EC2 Checks

**Module**

```text
worker/scans/ec2.py
```

Current checks:

* List running EC2 instances
* Detect security groups open to `0.0.0.0/0`

Example finding:

```json
{
  "type": "SecurityGroupOpen",
  "severity": "critical",
  "resource": "sg-123456",
  "details": "Port 22 is open to the internet"
}
```

---

# AWS IAM Checks

**Module**

```text
worker/scans/iam.py
```

Current checks:

* Verify MFA for the authenticated IAM user
* Check root account MFA status

Example finding:

```json
{
  "type": "RootMFADisabled",
  "severity": "high",
  "resource": "RootAccount",
  "details": "Root account does not have MFA enabled"
}
```

---

# Report Structure

All scan modules return findings using a consistent structure.

```json
{
  "findings": [
    {
      "type": "FindingType",
      "severity": "critical",
      "resource": "resource-name",
      "details": "Description of the issue"
    }
  ]
}
```

Using a standardized format makes it easier to display findings in the dashboard and add new scan modules.

---

# AWS Credentials

Cloud-Sentinel does **not** store AWS credentials in the repository.

The project uses:

```bash
aws configure export-credentials
```

The `start.sh` script exports the credentials as environment variables before starting the Docker containers.

Benefits:

* No secrets committed to Git
* Uses the AWS CLI credential store
* Easier local development
* Compatible with temporary credentials

---

# Required AWS Permissions

The Worker requires read-only access to the AWS services it scans.

Typical permissions include:

### Amazon S3

* `s3:ListAllMyBuckets`
* `s3:GetBucketEncryption`
* `s3:GetBucketPolicyStatus`
* `s3:GetPublicAccessBlock`

### Amazon EC2

* `ec2:DescribeInstances`
* `ec2:DescribeSecurityGroups`

### AWS IAM

* `iam:GetAccountSummary`
* `iam:ListMFADevices`
* `iam:GetUser`

> Grant only the minimum permissions required to perform the audit.

---

# Extending the Audit Engine

Adding support for a new AWS service is straightforward.

1. Create a new module in:

```text
worker/scans/
```

2. Implement the security checks.

3. Return findings using the standard report format.

4. Import and execute the new scan from:

```text
worker/services/audit.py
```

No changes to the Dashboard or Gateway are required as long as the report format remains consistent.

---

# Future Enhancements

Potential additions include:

* Amazon RDS security checks
* AWS Lambda configuration checks
* Amazon ECS cluster audits
* Amazon EKS security audits
* AWS CloudTrail validation
* AWS Config compliance checks
* AWS Security Hub integration
* CIS AWS Foundations Benchmark support

These enhancements can be implemented as additional scan modules without modifying the overall system architecture.
