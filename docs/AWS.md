# AWS audit engine

The worker uses boto3 to inspect selected AWS configuration and returns explicit
check evidence. It does not modify AWS resources or invoke Lambda functions.

## Scope and supported checks

| Service / module | Scope and checks |
| --- | --- |
| S3 (`worker/scans/s3.py`) | Account bucket inventory with each bucket's actual region; default encryption, effective account/bucket Block Public Access, policy-public status, and public ACL grants |
| EC2 (`worker/scans/ec2.py`) | Selected region; running-instance inventory and security-group ingress rules, including public IPv4/IPv6 exposure |
| IAM (`worker/scans/iam.py`) | Account-wide root MFA, console-user MFA, and unused access keys; users without console passwords skip the console MFA check |
| RDS (`worker/scans/rds.py`) | Selected region; DB instance public-accessibility flag and storage encryption |
| Lambda (`worker/scans/lambda_checks.py`) | Selected region; public invoke policies, Function URL configuration and matching grants, and a maintained runtime-support catalog |

`worker/services/audit.py` runs the selected services and records their scope.
Empty inventories are marked `SKIPPED`. Missing permissions, unexpected API
failures, and policy evidence that cannot be established produce `UNKNOWN`.
A service failure does not discard evidence already collected from other services.

These are configuration assessments. An open security-group rule or RDS public
flag alone does not prove end-to-end reachability. S3 organization and access-point
controls are outside this assessment. Lambda conditional/deny policies may need
manual review; unknown/custom runtimes are skipped. The runtime catalog is a
maintained code snapshot, not a live AWS support feed.

## Credentials and connected accounts

With no `connection_id`, the worker uses boto3's configured credential chain.
For local AWS CLI credentials, `./start.sh --refresh-aws` explicitly writes
an ignored `.aws.env` file and starts the containers. Plain `./start.sh` does
not refresh credentials. See [Deployment](DEPLOYMENT.md) for local development
and workload-role alternatives.

To connect another AWS account you own:

1. Open **Accounts → Connect account**. The console generates an External ID.
2. Use the guided CloudFormation link, when configured, or upload
   [`cloud-sentinel-scan-role.yaml`](../infra/cloudformation/cloud-sentinel-scan-role.yaml)
   manually with the worker's trusted principal ARN and the generated External ID.
3. Save the stack's role ARN, a connection name, and default region in the console.
4. Select that connection when starting a scan. Saving it does not validate AWS
   access; a scan resolves the actual AWS identity and records its account ID.

The guided link requires server-side `CFN_TEMPLATE_URL` and
`TRUSTED_PRINCIPAL_ARN`. The worker identity needs permission to assume the
chosen role; the bundled
[worker identity policy](../infra/cloudformation/worker-identity-policy.json)
scopes this to the `CloudSentinelScanRole*` naming pattern.

Each AssumeRole request includes the stored External ID and requests a one-hour
session. Temporary session credentials remain in worker memory; connection
records store role configuration. Connection list/create responses omit the
External ID.

Disconnecting marks the connection inactive and pauses its schedules. Queued
scans for that connection fail rather than switch accounts. An already running
scan may finish with its existing session. Disconnecting does not delete the
role in AWS or remove historical reports.

## Scan-role permissions

The scan role needs read access for the SDK operations used by the selected
modules. Inventory helpers paginate where supported. Review the modules alongside
the role policy when updating scanners.

**The bundled CloudFormation policy predates some current checks.** It does
not yet include permissions for the S3 bucket-location, bucket/account Block
Public Access, and bucket-policy-status reads, or the IAM login-profile read.
Using it without additional permissions can produce partial reports. Its
ACL-only comment is also outdated: the scanner now examines policy status.
Update the role's read permissions for those operations before expecting
complete evidence; the current template is not a complete permission contract.

Existing policy sections cover S3 bucket inventory/encryption/ACLs, EC2 instance
and security-group descriptions, IAM user/MFA/key inventory, STS identity,
RDS descriptions, and Lambda inventory/URL/policy reads. Permission failures
remain visible as unknown evidence in reports.

## Floci mode

Set `FLOCI_ENDPOINT` on both gateway and worker to enable `mode: "floci"` and
the console's emulator option. Use an endpoint reachable from the worker; for
a host service in the container stack, `host.docker.internal` is configured.
Floci clients use dummy credentials and cannot select an AWS connection.
The emulator must support the requested service operations, including STS
identity; unsupported operations may fail a job or produce unknown checks.
Root MFA is explicitly skipped because emulator data cannot establish real
AWS root-account posture.

## Finding and report contract

The common `check()` helper returns stable finding IDs plus `type`, `category`,
`resource`, `region`, `status`, `severity`, `title`, `description`, `details`,
and `remediation`. The `guarded()` helper converts unavailable evidence into
an `UNKNOWN` finding with a stable error code.

| Status | Meaning |
| --- | --- |
| `PASS` | Evidence supports the assessed check |
| `FAIL` | Evidence shows the assessed misconfiguration |
| `UNKNOWN` | Evidence was unavailable or requires additional evaluation |
| `SKIPPED` | Not applicable or not evaluated in this scope |

Failed checks use critical, medium, or low severity; passes use `good` and
unknown/skipped checks use `info`. Resource check counts exclude correlations.
Any unknown resource check sets `partial` and `score_provisional` to true.
Scores deduct 15/5/1 per critical/medium/low failed check from 100, floored at
zero. No observed pass/fail checks means a null score and grade.

CIS mappings currently cover root MFA (1.5), console-user MFA (1.10), S3 Block
Public Access (2.1.5), and relevant remote-administration ingress (5.2).
Unused access-key evidence does not assess the whole credential control, so
it is not mapped. RDS and Lambda checks are also unmapped. Summaries count
passing, failing, and unknown observed control groups, with a partial-assessment
note; they do not certify benchmark compliance.

Comparisons require equal account, connection, region, mode, service set, and
schema version. Stable IDs track new, resolved, changed, severity-changed, and
unobserved findings. A previous failure obscured by unavailable evidence is
tracked as unobserved. Correlated findings link supporting observations without
adding duplicate score penalties.

## Extending the scanner

1. Add checks using `check()`, `guarded()`, and paginated `inventory()` in the
   relevant `worker/scans` module. Preserve stable resource/rule identity.
2. For a new service, register its scanner in `worker/services/audit.py`, add
   its client/service to `worker/worker.py`, and update the gateway service
   allowlist and dashboard scan selection/defaults.
3. Update the connected-role policy for new SDK reads and document scope.
4. Add meaningful mocked coverage in `tests/test_worker.py`, especially for
   unavailable evidence, pagination, and policy ambiguity. Follow [Testing](TESTING.md).
