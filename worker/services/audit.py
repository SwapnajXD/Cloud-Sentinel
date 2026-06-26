from datetime import datetime, timezone

from scans.s3 import (
    list_unencrypted_s3_buckets,
    check_public_s3_buckets,
)
from scans.ec2 import (
    list_running_ec2_instances,
    check_open_security_groups,
)
from scans.iam import (
    check_mfa_for_current_user,
    check_root_mfa_enabled,
)


def build_audit_report(task, aws_clients):
    findings = []

    # S3 Encryption
    for bucket in list_unencrypted_s3_buckets(aws_clients["s3"]):
        findings.append({
            "severity": "critical" if not bucket["encrypted"] else "good",
            "type": "S3Encryption",
            "resource": bucket["bucket"],
            "details": bucket["details"],
        })

    # S3 Public
    findings.extend(check_public_s3_buckets(aws_clients["s3"]))

    # EC2 Instances
    for instance in list_running_ec2_instances(aws_clients["ec2"]):
        findings.append({
            "severity": "medium",
            "type": "EC2Instance",
            "resource": instance["instance_id"],
            "details": f"Type: {instance['type']}, State: {instance['state']}",
        })

    # Security Groups
    findings.extend(check_open_security_groups(aws_clients["ec2"]))

    # IAM MFA
    mfa = check_mfa_for_current_user(
        aws_clients["iam"], aws_clients["sts"]
    )

    findings.append({
        "severity": "critical" if not mfa["enabled"] else "good",
        "type": "IAMMFA",
        "resource": mfa.get("user_name", "N/A"),
        "details": f"MFA Status: {mfa['status']}",
    })

    # Root MFA
    findings.extend(
        check_root_mfa_enabled(
            aws_clients["iam"], aws_clients["sts"]
        )
    )

    return {
        "task_id": task.get("task_id"),
        "action": task.get("action"),
        "user_id": task["user_id"],
        "requested_at": task.get("requested_at")
        or datetime.now(timezone.utc).isoformat(),
        "findings": findings,
    }