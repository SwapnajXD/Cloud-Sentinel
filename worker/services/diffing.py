"""Compare stable resource/rule identities, preserving first/last observed failure."""
from datetime import datetime, timezone


def _finding_key(finding):
    return finding.get('id') or (finding.get('type'), finding.get('resource'), finding.get('region'))


def compute_diff(current_findings, previous_findings, observed_at=None):
    now = observed_at or datetime.now(timezone.utc).isoformat()
    previous = {_finding_key(f): f for f in previous_findings or []}
    current = {_finding_key(f): f for f in current_findings}
    unknown_services = {f.get('category') for f in current_findings if f.get('status') == 'UNKNOWN'}
    def unobserved(finding):
        latest = current.get(_finding_key(finding))
        return (latest is not None and (latest.get('status') == 'UNKNOWN' or
                latest.get('status') == 'SKIPPED' and finding.get('status') == 'FAIL')) or (
            latest is None and finding.get('category') in unknown_services)
    counts = {key: 0 for key in ('new', 'resolved', 'unchanged', 'changed', 'severity_changed', 'unobserved')}
    resolved = []
    for key, finding in current.items():
        old = previous.get(key)
        failed = finding.get('status') == 'FAIL'
        old_failed = old is not None and old.get('status') == 'FAIL'
        if old is None:
            change = 'new' if previous_findings is not None and failed else 'baseline'
        elif finding.get('status') in ('UNKNOWN', 'SKIPPED') and old_failed:
            change = 'unobserved'
        elif failed and old.get('status') == 'PASS':
            change = 'new'
        elif old_failed and finding.get('status') == 'PASS':
            change = 'resolved'
        elif failed and old_failed and finding.get('severity') != old.get('severity'):
            change = 'severity_changed'
        elif any(finding.get(k) != old.get(k) for k in ('status', 'description', 'severity')):
            change = 'changed'
        else:
            change = 'unchanged'
        if change in counts:
            counts[change] += 1
        finding['change'] = change
        finding['is_new'] = change == 'new'
        finding['first_detected'] = (old.get('first_detected') if old and (old_failed or old.get('status') in ('UNKNOWN', 'SKIPPED')) else None) or (now if failed else None)
        finding['last_detected'] = now if failed else old.get('last_detected') if old else None
        if change == 'resolved':
            resolved.append(old)
    for key, finding in previous.items():
        if key in current or finding.get('status') != 'FAIL':
            continue
        sources = [previous.get(source.get('id')) for source in finding.get('correlates', [])]
        if unobserved(finding) or any(source is not None and unobserved(source) for source in sources):
            counts['unobserved'] += 1
        else:
            counts['resolved'] += 1
            resolved.append(finding)
    return {'has_previous_scan': previous_findings is not None, **{key + '_count': value for key, value in counts.items()},
            'persisting_count': sum(f.get('status') == 'FAIL' and f['change'] in ('unchanged', 'changed', 'severity_changed') for f in current_findings),
            'new_findings': [f for f in current_findings if f['is_new']], 'resolved_findings': resolved}
