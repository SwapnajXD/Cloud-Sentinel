"""
Compares a scan's findings against the user's previous scan (if any), so a
report can show what's new, what's resolved, and what's still outstanding
- instead of every scan reading as an unrelated snapshot.
"""


def _finding_key(finding):
    """A finding's stable identity across scans - what it is and what
    it's about. Good enough since types are specific (e.g.
    "S3PublicAccess") and resource is a real identifier (bucket name,
    instance ID, access key ID, etc.)."""
    return (finding.get("type"), finding.get("resource"))


def compute_diff(current_findings, previous_findings):
    """Mutates `current_findings` in place to tag each one with `is_new`,
    and returns a diff summary. If there's no previous scan, nothing is
    marked new - there's nothing yet to compare against."""
    if previous_findings is None:
        for f in current_findings:
            f["is_new"] = False
        return {
            "has_previous_scan": False,
            "new_count": 0,
            "resolved_count": 0,
            "persisting_count": len(current_findings),
            "new_findings": [],
            "resolved_findings": [],
        }

    previous_keys = {_finding_key(f) for f in previous_findings}
    current_keys = {_finding_key(f) for f in current_findings}

    new_findings = []
    for f in current_findings:
        is_new = _finding_key(f) not in previous_keys
        f["is_new"] = is_new
        if is_new:
            new_findings.append(f)

    resolved_keys = previous_keys - current_keys
    resolved_findings = [f for f in previous_findings if _finding_key(f) in resolved_keys]

    return {
        "has_previous_scan": True,
        "new_count": len(new_findings),
        "resolved_count": len(resolved_findings),
        "persisting_count": len(current_keys & previous_keys),
        "new_findings": new_findings,
        "resolved_findings": resolved_findings,
    }
