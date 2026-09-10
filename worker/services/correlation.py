"""Related observed failures; these annotations do not add score penalties."""
from scans.common import check


def find_compound_risks(findings):
    failed = [f for f in findings if f.get('status') == 'FAIL']
    result = []

    def related(kind, resource, title, evidence, sources, region='global'):
        result.append(check(kind, 'Correlated', resource, 'FAIL', title, evidence,
                            'Review and remediate the linked source findings.', region=region,
                            identity=sorted(f['id'] for f in sources),
                            correlates=[{'id': f['id'], 'type': f['type'], 'resource': f['resource']} for f in sources]))

    for rule in (f for f in failed if f['type'] == 'SecurityGroupOpen'):
        ports = rule.get('rule', {})
        lo, hi = ports.get('from_port'), ports.get('to_port')
        admin = ports.get('protocol') == '-1' or (ports.get('protocol') in ('tcp', '6') and lo is not None and hi is not None and any(lo <= p <= hi for p in (22, 3389)))
        if not admin:
            continue
        for instance in (f for f in findings if f['type'] == 'EC2Instance'):
            if rule['resource'] in instance.get('security_groups', []) and instance.get('public_ip'):
                related('CompoundVerifiedRemoteAccess', instance['resource'], 'Public instance with open administration ingress',
                        'An open administration rule is attached to a running instance with a public IP. Routes, NACLs and host firewalls were not tested; reachability is not verified.', [rule, instance], instance['region'])
    roots = [f for f in failed if f['type'] == 'RootMFA']
    users = [f for f in failed if f['type'] == 'IAMUserMFA']
    if roots and users:
        related('CompoundNoMFAAnywhere', 'account', 'Root and console users lack MFA',
                f'Root and {len(users)} assessed console user(s) lack MFA. Other identities may have MFA.', roots + users)
    for key in (f for f in failed if f['type'] == 'IAMUnusedAccessKey'):
        for user in users:
            if key.get('user_name') == user['resource']:
                related('CompoundStaleKeyNoMFA', user['resource'], 'Stale key and console MFA gap',
                        'This user has two independent credential risks. Enabling console MFA does not automatically protect API access keys.', [key, user])
    for exposed_type, encryption_type in [('S3PublicAccess', 'S3Encryption'), ('RDSPubliclyAccessible', 'RDSEncryption')]:
        for exposed in (f for f in failed if f['type'] == exposed_type):
            for encryption in (f for f in failed if f['type'] == encryption_type and f['resource'] == exposed['resource']):
                related(f'Compound{exposed_type}And{encryption_type}', exposed['resource'], 'Exposure and encryption configuration gaps',
                        'Both checks failed. Encryption at rest does not prevent reads authorized by a public policy.', [exposed, encryption], exposed['region'])
    for runtime in (f for f in failed if f['type'] == 'LambdaDeprecatedRuntime'):
        exposed = [f for f in failed if f['type'] in ('LambdaPublicFunctionURL', 'LambdaPublicInvokePermission') and f['resource'] == runtime['resource']]
        if exposed:
            related('CompoundLambdaExposedAndOutdated', runtime['resource'], 'Public invocation on a deprecated runtime',
                    'Public invocation grants and a deprecated runtime were both observed.', [runtime] + exposed, runtime['region'])
    return result
