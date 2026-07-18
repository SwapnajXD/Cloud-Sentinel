"""
Maps a subset of Cloud-Sentinel's findings to CIS AWS Foundations Benchmark
v1.4.0 control IDs, and computes an overall risk score for a report.

Deliberately NOT comprehensive: the CIS AWS Foundations Benchmark itself
only covers IAM, S3, logging, monitoring, and networking. RDS and Lambda
findings are real, useful checks, but they belong to AWS's separate
"Foundational Security Best Practices" standard, not CIS - so they're left
unmapped here rather than force-fit into a benchmark that doesn't actually
cover them. An honest partial mapping is worth more than a fabricated
complete one.
"""

CIS_VERSION = "CIS AWS Foundations Benchmark v1.4.0"

# control_id -> title, exactly as published by CIS.
CIS_CONTROLS = {
    "1.5": 'Ensure MFA is enabled for the "root" account',
    "1.10": "Ensure MFA is enabled for all IAM users that have a console password",
    "1.12": "Ensure credentials unused for 90 days or greater are disabled",
    "2.1.5": "Ensure that S3 Buckets are configured with 'Block Public Access'",
    "5.2": "Ensure no security groups allow ingress from 0.0.0.0/0 to remote server administration ports",
}


def map_finding_to_cis(finding):
    """Returns {"control_id": ..., "control_title": ..., "version": ...} if
    this finding corresponds to a real CIS control, otherwise None."""
    ftype = finding.get("type")

    if ftype == "RootMFA":
        control_id = "1.5"
    elif ftype in ("IAMMFA", "IAMUserMFA"):
        control_id = "1.10"
    elif ftype == "IAMUnusedAccessKey":
        control_id = "1.12"
    elif ftype == "S3PublicAccess":
        control_id = "2.1.5"
    elif ftype == "SecurityGroupOpen":
        # CIS 5.2 is specifically about SSH/RDP ("remote server
        # administration ports"), not any arbitrary open port - only
        # attach it when the finding is actually about one of those.
        title = finding.get("title", "")
        if "SSH" in title or "RDP" in title:
            control_id = "5.2"
        else:
            return None
    else:
        return None

    return {
        "control_id": control_id,
        "control_title": CIS_CONTROLS[control_id],
        "version": CIS_VERSION,
    }


def annotate_findings_with_cis(findings):
    """Mutates each finding in place, adding a "cis" key where a mapping
    applies. Returns the same list for convenience."""
    for f in findings:
        mapping = map_finding_to_cis(f)
        if mapping:
            f["cis"] = mapping
    return findings


def compute_cis_summary(findings):
    """One row per distinct CIS control actually touched by this scan's
    findings, worst outcome wins if a control is hit by more than one
    finding (e.g. two IAM users both failing 1.10)."""
    control_outcomes = {}

    for f in findings:
        cis = f.get("cis")
        if not cis:
            continue
        control_id = cis["control_id"]
        passed = f.get("severity") == "good"
        # Once a control has failed for any finding, it stays failed.
        control_outcomes[control_id] = control_outcomes.get(control_id, True) and passed

    total = len(control_outcomes)
    passing = sum(1 for v in control_outcomes.values() if v)

    return {
        "version": CIS_VERSION,
        "controls_assessed": total,
        "controls_passing": passing,
        "controls_failing": total - passing,
    }


# =========================
# Risk score
# =========================
# Simple, transparent, additive model - deliberately not a black-box/ML
# score. Start at 100, deduct a fixed weight per finding by severity,
# floor at 0. Easy to explain, easy to defend, easy to reproduce by hand.
SEVERITY_PENALTY = {
    "critical": 15,
    "medium": 5,
    "low": 1,
    "good": 0,
}
MAX_PENALTY = 100


def compute_risk_score(findings):
    penalty = sum(SEVERITY_PENALTY.get(f.get("severity"), 0) for f in findings)
    return max(0, 100 - min(penalty, MAX_PENALTY))


def score_to_grade(score):
    if score >= 90:
        return "A"
    if score >= 75:
        return "B"
    if score >= 60:
        return "C"
    if score >= 40:
        return "D"
    return "F"
