"""Partial CIS v1.4 mapping of explicit checks, never a full certification."""
CIS_VERSION = 'CIS AWS Foundations Benchmark v1.4.0'
CIS_CONTROLS = {
    '1.5': 'Root account MFA', '1.10': 'MFA for IAM users with a console password',
    '1.12': 'Disable credentials unused for 90 days', '2.1.5': 'S3 Block Public Access',
    '5.2': 'Restrict remote administration ingress',
}


def map_finding_to_cis(finding):
    kind = finding.get('type')
    control = None
    if kind == 'RootMFA':
        control = '1.5'
    elif kind == 'IAMUserMFA' and finding.get('console_user'):
        control = '1.10'
    elif kind == 'IAMUnusedAccessKey':
        # This is access-key evidence only; no console password age assessment.
        # CIS 1.12 covers all credentials, so do not claim full control verification.
        return None
    elif kind == 'S3BlockPublicAccess':
        control = '2.1.5'
    elif kind == 'SecurityGroupOpen':
        rule = finding.get('rule', {})
        lo, hi = rule.get('from_port'), rule.get('to_port')
        if rule.get('protocol') == '-1' or (rule.get('protocol') in ('tcp', '6') and lo is not None and hi is not None and any(lo <= p <= hi for p in (22, 3389))):
            control = '5.2'
    if control:
        return {'control_id': control, 'control_title': CIS_CONTROLS[control], 'version': CIS_VERSION}
    return None


def annotate_findings_with_cis(findings):
    for finding in findings:
        mapping = map_finding_to_cis(finding)
        if mapping:
            finding['cis'] = mapping
    return findings


def compute_cis_summary(findings):
    outcomes = {}
    rank = {'SKIPPED': 0, 'PASS': 1, 'UNKNOWN': 2, 'FAIL': 3}
    for finding in findings:
        if not finding.get('cis'):
            continue
        control = finding['cis']['control_id']
        state = finding['status']
        if rank[state] > rank.get(outcomes.get(control), -1):
            outcomes[control] = state
    return {'version': CIS_VERSION, 'controls_assessed': len(outcomes),
            'controls_passing': sum(s == 'PASS' for s in outcomes.values()),
            'controls_failing': sum(s == 'FAIL' for s in outcomes.values()),
            'controls_unknown': sum(s == 'UNKNOWN' for s in outcomes.values()),
            'note': 'Selected controls and resources only; not a complete benchmark assessment.'}


def compute_risk_score(findings):
    return max(0, 100 - sum({'critical': 15, 'medium': 5, 'low': 1}.get(f.get('severity'), 0)
                            for f in findings if f.get('status') == 'FAIL' and f.get('category') != 'Correlated'))


def score_to_grade(score):
    return next((grade for threshold, grade in [(90, 'A'), (75, 'B'), (60, 'C'), (40, 'D')] if score >= threshold), 'F')
