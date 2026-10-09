"""Related observed failures; these annotations do not add score penalties."""
from scans.common import check


def find_compound_risks(findings):
    failed = [f for f in findings if f.get('status') == 'FAIL']
    result = []

    def related(kind, resource, title, evidence, sources, region='global', attack_path=None):
        annotation = check(kind, 'Correlated', resource, 'FAIL', title, evidence,
                           'Review and remediate the linked source findings.', region=region,
                           identity=sorted(f['id'] for f in sources),
                           correlates=[{'id': f['id'], 'type': f['type'], 'resource': f['resource']} for f in sources])
        if attack_path:
            annotation['attack_path'] = attack_path
        result.append(annotation)

    for rule in (f for f in failed if f['type'] == 'SecurityGroupOpen'):
        ports = rule.get('rule', {})
        lo, hi = ports.get('from_port'), ports.get('to_port')
        admin = ports.get('protocol') == '-1' or (ports.get('protocol') in ('tcp', '6') and lo is not None and hi is not None and any(lo <= p <= hi for p in (22, 3389)))
        cidrs = sorted(set(ports.get('cidrs') or []) & {'0.0.0.0/0', '::/0'})
        if not admin or not cidrs:
            continue
        for instance in (f for f in findings if f['type'] == 'EC2Instance'):
            if (instance.get('status') == 'SKIPPED'
                    and rule['resource'] in instance.get('security_groups', [])
                    and instance.get('public_ip')):
                observed_rule = rule.get('rule', {})
                protocol = observed_rule.get('protocol') or 'unknown protocol'
                lo, hi = observed_rule.get('from_port'), observed_rule.get('to_port')
                protocol_label = 'all protocols' if protocol == '-1' else protocol
                ports = 'all ports' if protocol == '-1' else str(lo) if lo == hi else f'{lo}-{hi}'
                path = {
                    'confidence': 'potential',
                    'summary': 'The security group allows administrative ingress from the internet and is attached to an instance with a public IP. End-to-end reachability was not verified.',
                    'steps': [
                        {'label': 'Internet source', 'resource': ', '.join(cidrs), 'finding_id': rule.get('id')},
                        {'label': f'{protocol_label} {ports} ingress rule', 'resource': rule['resource'], 'finding_id': rule.get('id')},
                        {'label': 'Running instance with a public IP', 'resource': instance['resource'], 'finding_id': instance.get('id')},
                    ],
                    'not_verified': ['Subnet route tables', 'Network ACLs', 'Host firewall rules'],
                }
                related('CompoundPotentialRemoteAccess', instance['resource'], 'Potential public administrative access path',
                        'Observed configuration links an internet-open administration rule to a running instance with a public IP. This is a potential exposure path, not proof of end-to-end reachability.',
                        [rule, instance], instance['region'], attack_path=path)
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
