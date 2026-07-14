from datetime import datetime, timezone

# ✅ FIXED: Included list_unencrypted_s3_buckets in the import
from scans.s3 import (
    check_public_s3_buckets,
    list_unencrypted_s3_buckets,
)

from scans.ec2 import (
    list_running_ec2_instances,
    check_open_security_groups,
)

from scans.iam import (
    check_mfa_for_current_user,
    check_root_mfa_enabled,
    check_unused_access_keys,
)

from scans.rds import (
    list_public_rds_instances,
    list_unencrypted_rds_instances,
)

from scans.lambda_checks import (
    list_public_lambda_functions,
    check_deprecated_lambda_runtimes,
)


def build_audit_report(task, aws_clients, mode="aws"):
    findings = []

    # =========================
    # ✅ S3 Encryption
    # =========================
    for bucket in list_unencrypted_s3_buckets(aws_clients["s3"]):
        passed = bucket["encrypted"]
        findings.append({
            "type": "S3Encryption",
            "category": "S3",
            "severity": "good" if passed else "critical",
            "resource": bucket["bucket"],
            "title": "S3 bucket encryption enabled" if passed else "S3 bucket encryption disabled",
            "description": (
                "This S3 bucket has server-side encryption enabled."
                if passed else
                "This S3 bucket does not have server-side encryption enabled."
            ),
            "impact": (
                "Data at rest is protected even if the underlying storage is compromised."
                if passed else
                "Sensitive data may be exposed if access is compromised."
            ),
            "remediation": (
                "No action needed."
                if passed else
                "Enable default encryption using AES256 or AWS KMS."
            ),
            "details": bucket["details"],
        })

    # =========================
    # ✅ S3 Public Access
    # =========================
    for f in check_public_s3_buckets(aws_clients["s3"]):
        f.update({
            "category": "S3",
            "title": "Public S3 bucket",
            "description": "Bucket is publicly accessible.",
            "impact": "Public exposure can lead to data leaks.",
            "remediation": "Remove public ACL or block public access.",
        })
        findings.append(f)

    # =========================
    # ✅ EC2 Instances
    # =========================
    for instance in list_running_ec2_instances(aws_clients["ec2"]):
        findings.append({
            "type": "EC2Instance",
            "category": "EC2",
            "severity": "medium",
            "resource": instance["instance_id"],
            "title": "Running EC2 instance",
            "description": "An EC2 instance is currently running.",
            "impact": "Running instances increase attack surface if not managed.",
            "remediation": "Stop unused instances or secure access.",
            "details": f"Type: {instance['type']}, State: {instance['state']}",
        })

    # =========================
    # ✅ Security Groups
    # =========================
    for f in check_open_security_groups(aws_clients["ec2"]):
        # ec2.py already computed a specific title/description for this
        # exact port/service exposure - don't stomp it with one generic
        # message for every rule regardless of what's actually open.
        f.setdefault("title", "Open security group rule")
        f.setdefault("description", f.get("details"))
        f.update({
            "category": "EC2",
            "impact": "The exposed port(s) may allow unauthorized access if the running service is vulnerable, unpatched, or misconfigured.",
            "remediation": "Restrict the rule to specific trusted IP ranges (e.g. your office or VPN CIDR) instead of 0.0.0.0/0, or remove it if not required.",
        })
        findings.append(f)

    # =========================
    # ✅ IAM MFA
    # =========================
    try:
        mfa = check_mfa_for_current_user(
            aws_clients["iam"], aws_clients["sts"]
        )
    except Exception:
        mfa = {"enabled": False, "status": "unknown"}

    mfa_ok = mfa["enabled"]
    findings.append({
        "type": "IAMMFA",
        "category": "IAM",
        "severity": "good" if mfa_ok else "critical",
        "resource": mfa.get("user_name", "N/A"),
        "title": "MFA enabled" if mfa_ok else "MFA not enabled",
        "description": (
            "Multi-factor authentication is enabled for this IAM user."
            if mfa_ok else
            "Multi-factor authentication is not enabled for this IAM user."
        ),
        "impact": (
            "This user is protected against credential-only compromise (e.g. a leaked password alone isn't enough)."
            if mfa_ok else
            "High risk of account compromise using stolen credentials."
        ),
        "remediation": "No action needed." if mfa_ok else "Enable MFA in AWS IAM console.",
        "details": f"MFA Status: {mfa['status']}",
    })

    # =========================
    # ✅ IAM Unused Access Keys
    # =========================
    try:
        for f in check_unused_access_keys(aws_clients["iam"], aws_clients["sts"]):
            f.update({
                "category": "IAM",
                "title": "Unused or stale access key",
                "description": "An IAM access key has not been used recently.",
                "impact": "Unused credentials are a common target for compromise since they're often forgotten.",
                "remediation": "Rotate or deactivate access keys that are no longer needed.",
            })
            findings.append(f)
    except Exception:
        pass

    # =========================
    # ✅ RDS Public Access & Encryption
    # =========================
    try:
        for f in list_public_rds_instances(aws_clients["rds"]):
            f.update({
                "category": "RDS",
                "title": "Publicly accessible RDS instance",
                "description": "This RDS instance is configured as publicly accessible.",
                "impact": "The database may be reachable directly from the internet.",
                "remediation": "Disable public accessibility and access the DB through a VPC/bastion instead.",
            })
            findings.append(f)
    except Exception:
        pass

    try:
        for db in list_unencrypted_rds_instances(aws_clients["rds"]):
            passed = db["encrypted"]
            findings.append({
                "type": "RDSEncryption",
                "category": "RDS",
                "severity": "good" if passed else "critical",
                "resource": db["instance"],
                "title": "RDS storage encryption enabled" if passed else "RDS storage encryption disabled",
                "description": (
                    "This RDS instance has storage encryption enabled."
                    if passed else
                    "This RDS instance does not have storage encryption enabled."
                ),
                "impact": (
                    "Data at rest is protected even if the underlying storage is compromised."
                    if passed else
                    "Data at rest may be exposed if underlying storage is compromised."
                ),
                "remediation": (
                    "No action needed."
                    if passed else
                    "Storage encryption can only be enabled at creation time; recreate the instance from an encrypted snapshot."
                ),
                "details": f"Engine: {db['engine']}",
            })
    except Exception:
        pass

    # =========================
    # ✅ Lambda Public Exposure & Deprecated Runtimes
    # =========================
    try:
        for f in list_public_lambda_functions(aws_clients["lambda"]):
            f.update({
                "category": "Lambda",
                "title": (
                    "Lambda function publicly invokable (Function URL)"
                    if f["type"] == "LambdaPublicFunctionURL" else
                    "Lambda function publicly invokable (resource policy)"
                ),
                "description": f["details"],
                "impact": "Anyone on the internet can invoke this function without authentication.",
                "remediation": (
                    "Set the Function URL's AuthType to AWS_IAM, or restrict the resource policy to specific principals."
                ),
            })
            findings.append(f)
    except Exception:
        pass

    try:
        for f in check_deprecated_lambda_runtimes(aws_clients["lambda"]):
            f.update({
                "category": "Lambda",
                "title": "Deprecated Lambda runtime",
                "description": f["details"],
                "impact": "This runtime no longer receives security patches from AWS.",
                "remediation": "Upgrade the function to a currently-supported runtime version.",
            })
            findings.append(f)
    except Exception:
        pass

    # =========================
    # ✅ Root MFA
    # =========================
    if mode == "aws":
        for f in check_root_mfa_enabled(
            aws_clients["iam"], aws_clients["sts"]
        ):
            passed = f["severity"] == "good"
            f.update({
                "category": "IAM",
                "title": "Root account MFA enabled" if passed else "Root account MFA disabled",
                "description": (
                    "The AWS account root user has MFA enabled."
                    if passed else
                    "The AWS account root user does not have MFA enabled."
                ),
                "impact": (
                    "The root account is protected against credential-only compromise."
                    if passed else
                    "Root account without MFA is highly dangerous - it has unrestricted access to the entire account."
                ),
                "remediation": "No action needed." if passed else "Enable MFA on the root account immediately.",
            })
            findings.append(f)
    else:
        findings.append({
            "type": "IAMRootMFA",
            "category": "IAM",
            "severity": "info",
            "resource": "N/A",
            "title": "Root MFA check skipped",
            "description": "Root MFA cannot be checked in Floci.",
            "impact": "Unknown root security posture.",
            "remediation": "Verify MFA in real AWS environment.",
            "details": "Skipped (not supported in Floci)",
        })

    # =========================
    # ✅ SORT BY SEVERITY
    # =========================
    findings.sort(
        key=lambda f: {"critical": 0, "medium": 1, "low": 2, "good": 3, "info": 4}.get(f["severity"], 5)
    )

    # =========================
    # ✅ SUMMARY
    # =========================
    summary = {
        "total": len(findings),
        "critical": sum(1 for f in findings if f["severity"] == "critical"),
        "medium": sum(1 for f in findings if f["severity"] == "medium"),
        "low": sum(1 for f in findings if f["severity"] == "low"),
        "good": sum(1 for f in findings if f["severity"] == "good"),
    }

    # =========================
    # ✅ FINAL OUTPUT
    # =========================
    return {
        "task_id": task.get("task_id"),
        "action": task.get("action"),
        "user_id": task["user_id"],
        "requested_at": task.get("requested_at")
        or datetime.now(timezone.utc).isoformat(),
        "summary": summary,
        "findings": findings,
    }