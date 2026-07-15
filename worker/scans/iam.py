def check_mfa_for_current_user(iam_client, sts_client):
    caller = sts_client.get_caller_identity()
    arn = caller.get("Arn", "")
    user_name = None

    if ":user/" in arn:
        user_name = arn.split("/", 1)[1]

    if not user_name:
        return {
            "enabled": False,
            "status": "unavailable",
            "details": "Not an IAM user",
        }

    response = iam_client.list_mfa_devices(UserName=user_name)

    enabled = len(response.get("MFADevices", [])) > 0

    return {
        "enabled": enabled,
        "status": "enabled" if enabled else "disabled",
        "user_name": user_name,
    }


def _list_all_users(iam_client):
    users = []
    if hasattr(iam_client, "get_paginator"):
        paginator = iam_client.get_paginator("list_users")
        for page in paginator.paginate():
            users.extend(page.get("Users", []))
    else:
        users = iam_client.list_users().get("Users", [])
    return users


def list_users_without_mfa(iam_client):
    """Account-wide MFA check: flags every IAM user without an MFA device,
    not just the identity that happens to be running the scan. Complements
    check_mfa_for_current_user, which only tells you about the scanner's
    own credentials."""
    findings = []

    for user in _list_all_users(iam_client):
        user_name = user.get("UserName")
        devices = iam_client.list_mfa_devices(UserName=user_name).get("MFADevices", [])

        if len(devices) == 0:
            findings.append({
                "type": "IAMUserMFA",
                "resource": user_name,
                "severity": "critical",
                "details": f"IAM user '{user_name}' does not have MFA enabled",
            })

    return findings


def check_root_mfa_enabled(iam_client, sts_client):
    findings = []

    account = sts_client.get_caller_identity()["Account"]

    summary = iam_client.get_account_summary()
    mfa_enabled = summary["SummaryMap"].get("AccountMFAEnabled", 0)

    findings.append({
        "type": "RootMFA",
        "resource": account,
        "severity": "critical" if mfa_enabled == 0 else "good",
        "details": "Root MFA is disabled" if mfa_enabled == 0 else "Root MFA enabled",
    })

    return findings


def check_unused_access_keys(iam_client, unused_after_days=90):
    """Account-wide: flags access keys that have never been used, or
    haven't been used in `unused_after_days` days, across EVERY IAM user -
    not just whichever identity happens to be running the scan. Stale keys
    are a common lateral-movement target since they're often forgotten but
    still valid."""
    from datetime import datetime, timezone

    findings = []

    for user in _list_all_users(iam_client):
        user_name = user.get("UserName")
        keys = iam_client.list_access_keys(UserName=user_name).get("AccessKeyMetadata", [])

        for key in keys:
            key_id = key.get("AccessKeyId")
            status = key.get("Status")

            last_used_resp = iam_client.get_access_key_last_used(AccessKeyId=key_id)
            last_used = last_used_resp.get("AccessKeyLastUsed", {}).get("LastUsedDate")

            if last_used is None:
                findings.append({
                    "type": "IAMUnusedAccessKey",
                    "resource": key_id,
                    "severity": "medium",
                    "details": f"Key for user '{user_name}' has never been used (status: {status})",
                })
                continue

            age_days = (datetime.now(timezone.utc) - last_used).days
            if age_days >= unused_after_days:
                findings.append({
                    "type": "IAMUnusedAccessKey",
                    "resource": key_id,
                    "severity": "medium",
                    "details": f"Key for user '{user_name}' last used {age_days} days ago (status: {status})",
                })

    return findings