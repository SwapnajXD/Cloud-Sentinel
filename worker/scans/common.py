"""Shared check contract. Unknown evidence is never classified as failure."""
import hashlib
import json


def error_code(error):
    return getattr(error, 'response', {}).get('Error', {}).get('Code', type(error).__name__)


def absent(error, *codes):
    return error_code(error) in codes


def inventory(client, operation, key, **kwargs):
    if hasattr(client, 'get_paginator') and client.can_paginate(operation):
        pages = client.get_paginator(operation).paginate(**kwargs)
    else:
        pages = [getattr(client, operation)(**kwargs)]
    return [item for page in pages for item in page.get(key, [])]


def check(kind, service, resource, status, title, evidence, remediation='', severity='critical', region='global', identity=None, **extra):
    stable = json.dumps([kind, service, resource, region, identity], sort_keys=True)
    return {'id': hashlib.sha256(stable.encode()).hexdigest()[:24], 'type': kind, 'category': service,
            'resource': resource, 'region': region, 'status': status, 'severity': severity if status == 'FAIL' else 'good' if status == 'PASS' else 'info',
            'title': title, 'description': evidence, 'details': evidence, 'remediation': remediation, **extra}


def guarded(kind, service, resource, region, action):
    try:
        return action()
    except Exception as error:
        return [check(kind, service, resource, 'UNKNOWN', 'Check unavailable',
                      f'AWS did not provide evidence ({error_code(error)}).',
                      'Verify the scan role permissions, service availability, and region, then scan again.', region=region)]
