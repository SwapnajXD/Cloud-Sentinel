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