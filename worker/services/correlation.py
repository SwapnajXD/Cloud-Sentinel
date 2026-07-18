"""
Correlates individual findings into compound risks - situations where two
or more findings together represent meaningfully more risk than either
finding alone. Every compound finding lists exactly which underlying
findings it was built from (see "correlates"), so nothing here is a black
box - you can always trace a compound risk back to its source findings.
"""


def _find(findings, ftype):
    return [f for f in findings if f.get("type") == ftype]


def _user_from_key_details(details):
    """IAMUnusedAccessKey's details string reads "Key for user 'alice' ..."
    - pull the username back out, since the finding's own `resource` field
    is the access key ID, not the user it belongs to."""
    marker = "Key for user '"
    if marker not in details:
        return None
    rest = details.split(marker, 1)[1]
    return rest.split("'", 1)[0]


def _verified_remote_access_exposure(findings):
    """An open SSH/RDP security group rule is a real, live-exploitable
    exposure when it's actually attached to a running, publicly-reachable
    instance - not just a theoretical misconfiguration sitting unused."""
    open_admin_rules = [
        f for f in _find(findings, "SecurityGroupOpen")
        if "SSH" in f.get("title", "") or "RDP" in f.get("title", "")
    ]
    if not open_admin_rules:
        return []

    instances = _find(findings, "EC2Instance")
    compounds = []

    for rule in open_admin_rules:
        sg_id = rule.get("resource")
        for instance in instances:
            if sg_id in instance.get("security_groups", []) and instance.get("public_ip"):
                compounds.append({
                    "type": "CompoundVerifiedRemoteAccess",
                    "category": "Correlated",
                    "severity": "critical",
                    "resource": instance.get("resource"),
                    "title": "Verified: remote admin port reachable on a live instance",
                    "description": (
                        f"{rule.get('title')} - and that security group is attached to "
                        f"a running instance ({instance.get('resource')}) with a public IP "
                        f"({instance.get('public_ip')}). This isn't a theoretical exposure; "
                        "it's a live, reachable target."
                    ),
                    "impact": "An attacker can attempt to connect directly to this instance's exposed administration port right now.",
                    "remediation": "Restrict the security group rule immediately, or stop the instance until it's fixed.",
                    "correlates": [
                        {"type": rule.get("type"), "resource": rule.get("resource")},
                        {"type": instance.get("type"), "resource": instance.get("resource")},
                    ],
                })

    return compounds


def _no_mfa_anywhere(findings):
    """Root account AND at least one IAM user both lacking MFA is a
    materially worse situation than either alone - there's no MFA
    protection anywhere in the account."""
    root_failing = [f for f in _find(findings, "RootMFA") if f.get("severity") != "good"]
    user_failing = _find(findings, "IAMUserMFA")  # only ever emitted for users lacking MFA

    if not root_failing or not user_failing:
        return []

    return [{
        "type": "CompoundNoMFAAnywhere",
        "category": "Correlated",
        "severity": "critical",
        "resource": "account-wide",
        "title": "No MFA protection anywhere in this account",
        "description": (
            f"The root account has no MFA, and {len(user_failing)} IAM user(s) "
            "also have no MFA. A single leaked password for any of these "
            "identities is enough to fully compromise them."
        ),
        "impact": "Total account takeover requires nothing beyond one leaked password.",
        "remediation": "Enable MFA on the root account and on every IAM user listed above.",
        "correlates": (
            [{"type": "RootMFA", "resource": f.get("resource")} for f in root_failing]
            + [{"type": "IAMUserMFA", "resource": f.get("resource")} for f in user_failing]
        ),
    }]


def _stale_key_without_mfa(findings):
    """A stale/unused access key belonging to a user who also has no MFA
    is a more attractive target than either fact alone - a forgotten door
    with no lock on it."""
    unused_keys = _find(findings, "IAMUnusedAccessKey")
    no_mfa_users = {f.get("resource") for f in _find(findings, "IAMUserMFA")}

    compounds = []
    for key_finding in unused_keys:
        user = _user_from_key_details(key_finding.get("details", ""))
        if user and user in no_mfa_users:
            compounds.append({
                "type": "CompoundStaleKeyNoMFA",
                "category": "Correlated",
                "severity": "critical",
                "resource": user,
                "title": f"Forgotten access key on an MFA-less user: '{user}'",
                "description": (
                    f"IAM user '{user}' has a stale/unused access key AND no MFA enabled. "
                    "A forgotten credential with no second factor behind it is exactly "
                    "the kind of access an attacker looks for."
                ),
                "impact": "This is a common real-world path to account compromise: an old, unmonitored credential with nothing else standing in the way.",
                "remediation": f"Rotate or deactivate the key, and enable MFA for '{user}'.",
                "correlates": [
                    {"type": "IAMUnusedAccessKey", "resource": key_finding.get("resource")},
                    {"type": "IAMUserMFA", "resource": user},
                ],
            })
    return compounds


def _exposed_and_unprotected(findings, public_type, encryption_type, resource_label):
    """Shared logic for 'the same resource is both publicly exposed AND
    unencrypted' - applies to both S3 buckets and RDS instances."""
    public_findings = _find(findings, public_type)
    unencrypted_by_resource = {
        f.get("resource"): f for f in _find(findings, encryption_type)
        if f.get("severity") != "good"
    }

    compounds = []
    for pf in public_findings:
        resource = pf.get("resource")
        if resource in unencrypted_by_resource:
            compounds.append({
                "type": f"Compound{public_type}And{encryption_type}",
                "category": "Correlated",
                "severity": "critical",
                "resource": resource,
                "title": f"{resource_label} '{resource}' is both publicly exposed and unencrypted",
                "description": (
                    f"'{resource}' is reachable from the internet AND has no encryption "
                    "at rest. Anyone who reaches it can read the data directly."
                ),
                "impact": "Data exposure here doesn't require breaking encryption - there isn't any.",
                "remediation": "Fix both the exposure and the missing encryption; either alone still leaves real risk.",
                "correlates": [
                    {"type": public_type, "resource": resource},
                    {"type": encryption_type, "resource": resource},
                ],
            })
    return compounds


def _lambda_exposed_and_outdated(findings):
    """A publicly-invokable Lambda function running a deprecated runtime -
    unauthenticated access to code that can't even get security patches
    anymore."""
    public_fns = {
        f.get("resource")
        for f in findings
        if f.get("type") in ("LambdaPublicFunctionURL", "LambdaPublicInvokePermission")
    }
    deprecated = _find(findings, "LambdaDeprecatedRuntime")

    compounds = []
    for d in deprecated:
        resource = d.get("resource")
        if resource in public_fns:
            compounds.append({
                "type": "CompoundLambdaExposedAndOutdated",
                "category": "Correlated",
                "severity": "critical",
                "resource": resource,
                "title": f"Lambda function '{resource}' is public AND on a deprecated runtime",
                "description": (
                    f"'{resource}' can be invoked by anyone on the internet without "
                    "authentication, and it's running on a runtime that no longer "
                    "receives security patches."
                ),
                "impact": "Unauthenticated access to unpatched code is materially riskier than either issue alone.",
                "remediation": "Restrict invocation (AuthType or resource policy) and upgrade the runtime - both are needed.",
                "correlates": [
                    {"type": "LambdaPublicFunctionURL", "resource": resource},
                    {"type": "LambdaDeprecatedRuntime", "resource": resource},
                ],
            })
    return compounds


def find_compound_risks(findings):
    """Runs every correlation rule and returns the compound findings to
    append to the report."""
    compounds = []
    compounds.extend(_verified_remote_access_exposure(findings))
    compounds.extend(_no_mfa_anywhere(findings))
    compounds.extend(_stale_key_without_mfa(findings))
    compounds.extend(_exposed_and_unprotected(findings, "S3PublicAccess", "S3Encryption", "S3 bucket"))
    compounds.extend(_exposed_and_unprotected(findings, "RDSPubliclyAccessible", "RDSEncryption", "RDS instance"))
    compounds.extend(_lambda_exposed_and_outdated(findings))
    return compounds
