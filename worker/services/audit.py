from datetime import datetime, timezone
from scans import s3, ec2, iam, rds, lambda_checks
from scans.common import check, guarded
from services.compliance import annotate_findings_with_cis, compute_cis_summary, compute_risk_score, score_to_grade
from services.correlation import find_compound_risks
from services.diffing import compute_diff

SCANNERS = {'s3': s3.scan, 'ec2': ec2.scan, 'iam': iam.scan, 'rds': rds.scan, 'lambda': lambda_checks.scan}


def build_audit_report(task, aws_clients, mode='aws', previous_report=None, progress=None):
    context = task['context']
    findings = []
    coverage = []
    for service in context['services']:
        if progress:
            progress(service)
        category = {'s3': 'S3', 'ec2': 'EC2', 'iam': 'IAM', 'rds': 'RDS', 'lambda': 'Lambda'}[service]
        region = 'global' if service in ('s3', 'iam') else context['region']
        rows = guarded(service + 'Inventory', category, 'service inventory', region, lambda: SCANNERS[service](aws_clients, context['region']))
        if mode == 'floci':
            rows = [f for f in rows if f['type'] != 'RootMFA']
            if service == 'iam':
                rows.append(check('RootMFA', 'IAM', 'account', 'SKIPPED', 'Root MFA not assessed', 'Floci does not establish real AWS root-account posture.'))
        if not rows:
            rows = [check(service + 'Inventory', category, 'service inventory', 'SKIPPED', 'No resources returned',
                          'No resources were returned for this service in the selected scope.', region=region)]
        findings.extend(rows)
        coverage.append({'service': service, 'region': region, 'status': 'UNKNOWN' if any(f['status'] == 'UNKNOWN' for f in rows) else 'ASSESSED', 'checks': len(rows)})
    annotate_findings_with_cis(findings)
    findings.extend(find_compound_risks(findings))
    findings.sort(key=lambda f: ({'FAIL': 0, 'UNKNOWN': 1, 'PASS': 2, 'SKIPPED': 3}[f['status']], {'critical': 0, 'medium': 1, 'low': 2}.get(f['severity'], 3), f['id']))
    compatible = previous_report and previous_report.get('context') == context
    now = datetime.now(timezone.utc).isoformat()
    diff = compute_diff(findings, previous_report['findings'] if compatible else None, now)
    checks = [f for f in findings if f['category'] != 'Correlated']
    counts = {state.lower(): sum(f['status'] == state for f in checks) for state in ('PASS', 'FAIL', 'SKIPPED', 'UNKNOWN')}
    score = compute_risk_score(checks) if counts['pass'] + counts['fail'] else None
    return {'schema_version': 2, 'task_id': task['task_id'], 'action': 'start_audit', 'user_id': task['user_id'],
            'requested_at': task.get('requested_at', now), 'completed_at': now, 'context': context,
            'connection_label': task.get('connection_label'), 'coverage': coverage, 'check_summary': counts,
            'partial': bool(counts['unknown']), 'score_provisional': bool(counts['unknown']),
            'assessment_note': 'Selected configuration checks only. IAM is account-wide; S3 inventory covers all buckets with their actual regions. EC2, RDS and Lambda use the selected region. No reachability testing or complete CIS certification.',
            'summary': {'total': len(findings), **{s: sum(f['severity'] == s for f in findings) for s in ('critical', 'medium', 'low', 'good')}},
            'risk_score': score, 'risk_grade': score_to_grade(score) if score is not None else None,
            'cis_summary': compute_cis_summary(checks), 'diff': diff, 'findings': findings}
