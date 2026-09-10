from scans.common import check, guarded, inventory, absent

BLOCK_KEYS = ('BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets')


def scan(clients, region):
    s3 = clients['s3']
    account = clients['sts'].get_caller_identity()['Account']
    try:
        account_block = clients['s3control'].get_public_access_block(AccountId=account)['PublicAccessBlockConfiguration']
    except Exception as error:
        account_block = {} if absent(error, 'NoSuchPublicAccessBlockConfiguration') else None
    findings = []
    for bucket in inventory(s3, 'list_buckets', 'Buckets'):
        name = bucket['Name']
        def assess():
            location = s3.get_bucket_location(Bucket=name).get('LocationConstraint')
            bucket_region = 'us-east-1' if not location else 'eu-west-1' if location == 'EU' else location
            def encryption():
                try:
                    rules = s3.get_bucket_encryption(Bucket=name)['ServerSideEncryptionConfiguration']['Rules']
                    encrypted = bool(rules)
                except Exception as error:
                    if not absent(error, 'ServerSideEncryptionConfigurationNotFoundError'):
                        raise
                    encrypted = False
                return [check('S3Encryption', 'S3', name, 'PASS' if encrypted else 'FAIL', 'Default bucket encryption',
                              'Default encryption is configured.' if encrypted else 'No default encryption configuration was returned.',
                              'Enable S3 default encryption with SSE-S3 or SSE-KMS.', region=bucket_region)]
            def public():
                try:
                    block = s3.get_public_access_block(Bucket=name)['PublicAccessBlockConfiguration']
                except Exception as error:
                    if not absent(error, 'NoSuchPublicAccessBlockConfiguration'):
                        raise
                    block = {}
                effective = {k: bool(block.get(k) or (account_block or {}).get(k)) for k in BLOCK_KEYS}
                full_block = all(effective.values())
                # Unknown account settings cannot negate bucket-level protection.
                known = full_block or account_block is not None
                result = [check('S3BlockPublicAccess', 'S3', name, 'PASS' if full_block else 'FAIL' if known else 'UNKNOWN',
                                'S3 Block Public Access', 'Effective account/bucket settings: ' + ', '.join(f'{k}={v}' for k, v in effective.items()) + ('' if known else '; account settings unavailable'),
                                'Enable all four Block Public Access settings at bucket or account level.', region=bucket_region)]
                if full_block:
                    result.append(check('S3PublicAccess', 'S3', name, 'PASS', 'Bucket public access', 'Account/bucket Block Public Access blocks public ACLs and policies. Organization and access-point configuration is outside this assessment.', region=bucket_region))
                    return result
                def exposure():
                    try:
                        policy_public = s3.get_bucket_policy_status(Bucket=name)['PolicyStatus']['IsPublic']
                    except Exception as error:
                        if not absent(error, 'NoSuchBucketPolicy'):
                            raise
                        policy_public = False
                    grants = s3.get_bucket_acl(Bucket=name).get('Grants', [])
                    public_acl = any(g.get('Grantee', {}).get('URI', '').endswith(('/AllUsers', '/AuthenticatedUsers')) for g in grants)
                    exposed = (public_acl and not effective['IgnorePublicAcls']) or (policy_public and not effective['RestrictPublicBuckets'])
                    return [check('S3PublicAccess', 'S3', name, 'UNKNOWN' if exposed and not known else 'FAIL' if exposed else 'PASS',
                                        'Bucket public access grants', f'Public ACL={public_acl}; public policy={policy_public}. Effective bucket/account restrictions considered; organization/access-point controls not assessed.',
                                        'Remove public grants and enable Block Public Access unless explicitly required.', region=bucket_region)]
                result.extend(guarded('S3PublicAccess', 'S3', name, bucket_region, exposure))
                return result
            return guarded('S3Encryption', 'S3', name, bucket_region, encryption) + guarded('S3PublicAccess', 'S3', name, bucket_region, public)
        findings.extend(guarded('S3Assessment', 'S3', name, 'global', assess))
    return findings
