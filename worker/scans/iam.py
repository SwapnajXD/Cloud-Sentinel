from datetime import datetime, timezone
from scans.common import check, guarded, inventory, absent


def check_mfa_for_current_user(iam_client, sts_client):
    arn = sts_client.get_caller_identity().get('Arn', '')
    if ':user/' not in arn:
        return {'enabled': None, 'status': 'not_applicable', 'details': 'Scanner is a root or role identity, not an IAM user'}
    user_name = arn.rsplit('/', 1)[-1]
    devices = inventory(iam_client, 'list_mfa_devices', 'MFADevices', UserName=user_name)
    return {'enabled': bool(devices), 'status': 'enabled' if devices else 'disabled', 'user_name': user_name}


def scan(clients, region):
    iam = clients['iam']
    findings = []
    def root():
        account = clients['sts'].get_caller_identity()['Account']
        enabled = iam.get_account_summary()['SummaryMap']['AccountMFAEnabled'] == 1
        return [check('RootMFA', 'IAM', account, 'PASS' if enabled else 'FAIL', 'Root account MFA',
                      'Root MFA enabled.' if enabled else 'Root MFA disabled.', 'Enable MFA for the AWS root user.')]
    findings.extend(guarded('RootMFA', 'IAM', 'account', 'global', root))
    try:
        users = inventory(iam, 'list_users', 'Users')
    except Exception as error:
        from scans.common import error_code
        findings.append(check('IAMInventory', 'IAM', 'users', 'UNKNOWN', 'IAM user inventory unavailable',
                              f'AWS did not provide evidence ({error_code(error)}).'))
        return findings
    for user in users:
        name = user['UserName']
        def mfa():
            try:
                iam.get_login_profile(UserName=name)
            except Exception as error:
                if not absent(error, 'NoSuchEntity'):
                    raise
                return [check('IAMUserMFA', 'IAM', name, 'SKIPPED', 'Console user MFA', 'This IAM user has no console password. MFA device presence does not establish API credential protection.')]
            devices = inventory(iam, 'list_mfa_devices', 'MFADevices', UserName=name)
            return [check('IAMUserMFA', 'IAM', name, 'PASS' if devices else 'FAIL', 'Console user MFA',
                          'Console password present; MFA ' + ('enabled.' if devices else 'disabled.'), 'Enable MFA for this console user.', console_user=True)]
        findings.extend(guarded('IAMUserMFA', 'IAM', name, 'global', mfa))
        def keys():
            result = []
            for key in inventory(iam, 'list_access_keys', 'AccessKeyMetadata', UserName=name):
                key_id = key['AccessKeyId']
                def assess_key():
                    if key['Status'] != 'Active':
                        return [check('IAMUnusedAccessKey', 'IAM', key_id, 'PASS', 'Unused access key', 'Key is inactive.', user_name=name)]
                    last_used = iam.get_access_key_last_used(AccessKeyId=key_id).get('AccessKeyLastUsed', {}).get('LastUsedDate')
                    since = last_used or key['CreateDate']
                    age = (datetime.now(timezone.utc) - since).days
                    return [check('IAMUnusedAccessKey', 'IAM', key_id, 'FAIL' if age >= 90 else 'PASS', 'Unused access key',
                                  f"Key for user '{name}': active; {age} days since {'last use' if last_used else 'creation (never used)' }.",
                                  'Deactivate unused keys after reviewing dependent workloads.', severity='medium', user_name=name)]
                result.extend(guarded('IAMUnusedAccessKey', 'IAM', key_id, 'global', assess_key))
            return result
        findings.extend(guarded('IAMUnusedAccessKey', 'IAM', name, 'global', keys))
    return findings
