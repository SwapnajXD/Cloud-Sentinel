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


def build_audit_report(task, aws_clients, mode="aws"):
    findings = []

    # =========================
    # ✅ S3 Encryption
    # =========================
    for bucket in list_unencrypted_s3_buckets(aws_clients["s3"]):
        findings.append({
            "type": "S3Encryption",
            "category": "S3",
            "severity": "critical" if not bucket["encrypted"] else "good",
            "resource": bucket["bucket"],
            "title": "S3 bucket encryption disabled",
            "description": "This S3 bucket does not have server-side encryption enabled.",
            "impact": "Sensitive data may be exposed if access is compromised.",
            "remediation": "Enable default encryption using AES256 or AWS KMS.",
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

    findings.append({
        "type": "IAMMFA",
        "category": "IAM",
        "severity": "critical" if not mfa["enabled"] else "good",
        "resource": mfa.get("user_name", "N/A"),
        "title": "MFA not enabled",
        "description": "Multi-factor authentication is not enabled for this IAM user.",
        "impact": "High risk of account compromise using stolen credentials.",
        "remediation": "Enable MFA in AWS IAM console.",
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
            findings.append({
                "type": "RDSEncryption",
                "category": "RDS",
                "severity": "critical" if not db["encrypted"] else "good",
                "resource": db["instance"],
                "title": "RDS storage encryption disabled",
                "description": "This RDS instance does not have storage encryption enabled.",
                "impact": "Data at rest may be exposed if underlying storage is compromised.",
                "remediation": "Storage encryption can only be enabled at creation time; recreate the instance from an encrypted snapshot.",
                "details": f"Engine: {db['engine']}",
            })
    except Exception:
        pass

    # =========================
    # ✅ Root MFA
    # =========================
    if mode == "aws":
        for f in check_root_mfa_enabled(
            aws_clients["iam"], aws_clients["sts"]
        ):
            f.update({
                "category": "IAM",
                "title": "Root account MFA",
                "description": "Root account MFA verification.",
                "impact": "Root account without MFA is highly dangerous.",
                "remediation": "Enable MFA on root account immediately.",
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