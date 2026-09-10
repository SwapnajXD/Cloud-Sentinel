"""Durable worker ownership, AWS evidence, and report-history regressions."""
import copy
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'worker'))
import worker
from botocore.exceptions import ClientError
from scans import ec2, iam, lambda_checks, rds, s3
from scans.common import check, guarded, inventory
from services import audit, database
from services.compliance import annotate_findings_with_cis, compute_cis_summary, compute_risk_score, map_finding_to_cis, score_to_grade
from services.correlation import find_compound_risks
from services.diffing import compute_diff


def aws_error(code='AccessDenied'):
    return ClientError({'Error': {'Code': code, 'Message': 'private provider details'}}, 'TestOperation')


def client(**responses):
    result = Mock()
    result.can_paginate.return_value = False
    for operation, response in responses.items():
        getattr(result, operation).return_value = response
    return result


def connection(rows=(), many=()):
    result = MagicMock()
    cursor = result.cursor.return_value.__enter__.return_value
    cursor.fetchone.side_effect = list(rows)
    cursor.fetchall.return_value = list(many)
    cursor.rowcount = 1
    return result, cursor


def task(**changes):
    result = {'task_id': 'task-1', 'user_id': 7, 'mode': 'aws', 'connection_id': None,
              'attempts': 1, 'lease_token': 'lease-1', 'payload': {'region': 'eu-west-1', 'services': ['s3']}}
    result.update(changes)
    return result


def finding(kind='S3Encryption', status='FAIL', resource='bucket', category='S3', **extra):
    return check(kind, category, resource, status, kind, 'Observed configuration.', **extra)


def report_task(services=('s3',), mode='aws'):
    return {'task_id': 'task-1', 'user_id': 7, 'context': {
        'account_id': '123456789012', 'connection_id': None, 'region': 'eu-west-1',
        'mode': mode, 'services': sorted(services), 'schema_version': 2}}


class DurableWorkerTests(unittest.TestCase):
    def test_claim_recovers_expired_jobs_and_claims_due_jobs_with_lock(self):
        conn, cursor = connection([task()])
        self.assertEqual(worker.claim_task(conn)['task_id'], 'task-1')
        sql = [call.args[0] for call in cursor.execute.call_args_list]
        self.assertIn('lease_until < NOW()', sql[0])
        self.assertIn('FOR UPDATE SKIP LOCKED', sql[1])
        self.assertIn('available_at<=NOW()', sql[1])
        self.assertIn('attempts=attempts+1', sql[1])
        conn.commit.assert_called_once()

    def test_no_due_task_returns_none(self):
        conn, _ = connection([None])
        self.assertIsNone(worker.claim_task(conn))

    def test_completion_persists_report_and_terminal_state_together(self):
        for partial, status in [(False, 'done'), (True, 'partial')]:
            with self.subTest(partial=partial):
                conn, cursor = connection([('task-1',), (55,)])
                self.assertEqual(worker.complete_task(conn, task(), {'partial': partial}), 55)
                calls = cursor.execute.call_args_list
                self.assertIn('lease_until>NOW()', calls[0].args[0])
                self.assertIn('ON CONFLICT(task_id)', calls[1].args[0])
                self.assertEqual(calls[2].args[1], (status, 55, 'task-1'))
                conn.commit.assert_called_once()

    def test_stale_worker_cannot_publish(self):
        conn, cursor = connection([None])
        self.assertIsNone(worker.complete_task(conn, task(), {'findings': []}))
        self.assertEqual(cursor.execute.call_count, 1)
        conn.rollback.assert_called_once()
        conn.commit.assert_not_called()

    def test_renewal_requires_unexpired_matching_lease(self):
        for updated in (0, 1):
            with self.subTest(updated=updated):
                conn, cursor = connection()
                cursor.rowcount = updated
                with patch.object(worker, 'get_db_connection', return_value=conn):
                    self.assertEqual(worker.renew_lease('task-1', 'lease-1'), bool(updated))
                sql, args = cursor.execute.call_args.args
                self.assertIn('lease_token=%s', sql)
                self.assertIn('lease_until>NOW()', sql)
                self.assertEqual(args[-2:], ('task-1', 'lease-1'))
                conn.close.assert_called_once()

    def test_retry_backoff_and_exhaustion(self):
        for attempt, status, delay in [(1, 'queued', 5), (3, 'queued', 20), (4, 'error', 40)]:
            with self.subTest(attempt=attempt), patch.object(worker, 'log'):
                conn, cursor = connection()
                with patch.object(worker, 'MAX_TASK_RETRIES', 3), patch.object(worker, 'TASK_RETRY_DELAY_SECONDS', 5):
                    worker.fail_task(conn, task(attempts=attempt), 'AccessDenied')
                sql, args = cursor.execute.call_args.args
                self.assertEqual((args[0], args[3]), (status, delay))
                self.assertIn('lease_token=%s', sql)
                conn.rollback.assert_called_once()
                conn.commit.assert_called_once()

    def test_process_uses_owned_connection_and_scope(self):
        conn, _ = connection()
        clients = {'sts': client(get_caller_identity={'Account': '123456789012'})}
        role = {'role_arn': 'arn:role', 'external_id': 'external', 'label': 'Production'}
        with patch.object(worker, 'get_aws_connection', return_value=role) as lookup, \
             patch.object(worker, 'get_aws_clients', return_value=clients) as factory, \
             patch.object(worker, 'get_latest_report', return_value=None), \
             patch.object(worker, 'build_audit_report', return_value={'findings': []}) as build, \
             patch.object(worker, 'complete_task', return_value=55), patch.object(worker, 'log'):
            result = worker.process_task(task(connection_id=9), conn=conn)
        self.assertEqual(result, {'status': 'ok', 'report_id': 55})
        lookup.assert_called_once_with(conn, 9, 7)
        factory.assert_called_once_with('aws', role_arn='arn:role', external_id='external', region='eu-west-1')
        self.assertEqual(build.call_args.args[0]['context']['connection_id'], 9)
        self.assertEqual(build.call_args.args[0]['context']['services'], ['s3'])
        conn.close.assert_not_called()

    def test_disconnected_account_never_falls_back_to_worker_credentials(self):
        conn, _ = connection()
        with patch.object(worker, 'get_aws_connection', return_value=None), \
             patch.object(worker, 'get_aws_clients') as factory, patch.object(worker, 'fail_task') as fail:
            result = worker.process_task(task(connection_id=9), conn=conn)
        self.assertEqual(result['status'], 'error')
        factory.assert_not_called()
        self.assertIn('disconnected', fail.call_args.args[2])

    def test_client_error_retries_and_closes_owned_connection(self):
        conn, _ = connection()
        with patch.object(worker, 'get_db_connection', return_value=conn), \
             patch.object(worker, 'get_aws_clients', side_effect=aws_error()), patch.object(worker, 'fail_task') as fail:
            result = worker.process_task(task())
        self.assertEqual(result['error'], 'AccessDenied')
        self.assertEqual(fail.call_args.args[2], 'AccessDenied')
        conn.close.assert_called_once()

    def test_progress_stops_scan_when_lease_is_lost(self):
        conn, _ = connection()
        clients = {'sts': client(get_caller_identity={'Account': '123456789012'})}
        def build(*args, **kwargs):
            kwargs['progress']('s3')
            self.fail('Lost lease must stop report construction')
        with patch.object(worker, 'get_latest_report', return_value=None), \
             patch.object(worker, 'renew_lease', return_value=False), \
             patch.object(worker, 'build_audit_report', side_effect=build), \
             patch.object(worker, 'complete_task') as complete, patch.object(worker, 'fail_task'), patch.object(worker, 'log'):
            result = worker.process_task(task(), conn=conn, aws_clients=clients)
        self.assertEqual(result['status'], 'error')
        complete.assert_not_called()

    def test_schedules_enqueue_and_advance_transactionally(self):
        schedule = {'id': 3, 'user_id': 7, 'mode': 'aws', 'connection_id': 9, 'region': 'eu-west-1', 'services': ['s3']}
        conn, cursor = connection(many=[schedule])
        with patch.object(worker, 'get_db_connection', return_value=conn):
            worker._check_due_schedules()
        calls = cursor.execute.call_args_list
        self.assertIn('FOR UPDATE SKIP LOCKED', calls[0].args[0])
        payload = calls[1].args[1][-1].adapted
        self.assertEqual(payload['connection_id'], 9)
        self.assertEqual(payload['params']['schedule_id'], 3)
        self.assertEqual(calls[2].args[1][0], payload['task_id'])
        conn.commit.assert_called_once()
        conn.close.assert_called_once()

    def test_schedule_failure_rolls_back_and_closes(self):
        conn, cursor = connection()
        cursor.execute.side_effect = RuntimeError('database unavailable')
        with patch.object(worker, 'get_db_connection', return_value=conn), self.assertRaises(RuntimeError):
            worker._check_due_schedules()
        conn.rollback.assert_called_once()
        conn.commit.assert_not_called()
        conn.close.assert_called_once()

    def test_connection_lookup_is_owner_scoped_and_active_only(self):
        conn, cursor = connection([None])
        self.assertIsNone(worker.get_aws_connection(conn, 9, 7))
        sql, args = cursor.execute.call_args.args
        self.assertIn('AND user_id=%s AND active', sql)
        self.assertEqual(args, (9, 7))

    def test_assume_role_uses_external_id_and_temporary_credentials(self):
        sts = client(assume_role={'Credentials': {'AccessKeyId': 'temporary', 'SecretAccessKey': 'secret', 'SessionToken': 'token'}})
        with patch.object(worker.boto3, 'client', return_value=sts), patch.object(worker.boto3, 'Session') as session:
            clients = worker.get_aws_clients(role_arn='arn:role', external_id='external', region='eu-west-1')
        self.assertEqual(sts.assume_role.call_args.kwargs['ExternalId'], 'external')
        self.assertEqual(session.call_args.kwargs['aws_session_token'], 'token')
        self.assertIn('s3control', clients)

    def test_assume_role_requires_external_id(self):
        with self.assertRaises(ValueError):
            worker.get_aws_clients(role_arn='arn:role')


class SchemaTests(unittest.TestCase):
    def test_migrations_are_locked_and_skip_applied_versions(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, '002.sql').write_text('SELECT 2')
            Path(directory, '001.sql').write_text('SELECT 1')
            conn, cursor = connection([('001.sql',), None])
            with patch.dict(os.environ, {'MIGRATIONS_DIR': directory}):
                database.ensure_schema(conn)
        statements = [c.args[0] for c in cursor.execute.call_args_list]
        self.assertIn('pg_advisory_xact_lock', statements[0])
        self.assertNotIn('SELECT 1', statements)
        self.assertIn('SELECT 2', statements)
        conn.commit.assert_called_once()

    def test_failed_migration_rolls_back(self):
        conn, cursor = connection()
        cursor.execute.side_effect = RuntimeError('DDL failed')
        with self.assertRaises(RuntimeError):
            database.ensure_schema(conn)
        conn.rollback.assert_called_once()
        conn.commit.assert_not_called()


class ScanTests(unittest.TestCase):
    def test_inventory_collects_every_page(self):
        sdk = client()
        sdk.can_paginate.return_value = True
        sdk.get_paginator.return_value.paginate.return_value = [{'Users': [{'UserName': 'a'}]}, {'Users': [{'UserName': 'b'}]}]
        self.assertEqual(len(inventory(sdk, 'list_users', 'Users')), 2)

    def test_permission_denied_is_unknown_and_redacts_provider_details(self):
        rows = guarded('S3Encryption', 'S3', 'bucket', 'global', Mock(side_effect=aws_error()))
        self.assertEqual(rows[0]['status'], 'UNKNOWN')
        self.assertIn('AccessDenied', rows[0]['description'])
        self.assertNotIn('private provider details', rows[0]['description'])

    def s3_clients(self, full_block=False):
        sdk = client(list_buckets={'Buckets': [{'Name': 'bucket'}]}, get_bucket_location={'LocationConstraint': 'EU'},
                     get_bucket_encryption={'ServerSideEncryptionConfiguration': {'Rules': [{}]}},
                     get_public_access_block={'PublicAccessBlockConfiguration': {k: full_block for k in s3.BLOCK_KEYS}},
                     get_bucket_policy_status={'PolicyStatus': {'IsPublic': True}}, get_bucket_acl={'Grants': []})
        return {'s3': sdk, 'sts': client(get_caller_identity={'Account': '123456789012'}),
                's3control': client(get_public_access_block={'PublicAccessBlockConfiguration': {}})}

    def test_s3_policy_only_exposure_and_actual_bucket_region(self):
        rows = s3.scan(self.s3_clients(), 'us-east-1')
        public = next(f for f in rows if f['type'] == 'S3PublicAccess')
        self.assertEqual(public['status'], 'FAIL')
        self.assertEqual(public['region'], 'eu-west-1')

    def test_s3_bucket_protection_survives_denied_account_settings(self):
        clients = self.s3_clients(full_block=True)
        clients['s3control'].get_public_access_block.side_effect = aws_error()
        rows = s3.scan(clients, 'us-east-1')
        self.assertTrue(all(f['status'] == 'PASS' for f in rows))
        clients['s3'].get_bucket_policy_status.assert_not_called()

    def test_s3_unknown_account_settings_cannot_confirm_exposure(self):
        clients = self.s3_clients()
        clients['s3control'].get_public_access_block.side_effect = aws_error()
        rows = s3.scan(clients, 'us-east-1')
        self.assertEqual(next(f for f in rows if f['type'] == 'S3PublicAccess')['status'], 'UNKNOWN')

    def test_s3_encryption_denial_keeps_public_access_evidence(self):
        clients = self.s3_clients()
        clients['s3'].get_bucket_encryption.side_effect = aws_error()
        rows = s3.scan(clients, 'us-east-1')
        self.assertEqual(next(f for f in rows if f['type'] == 'S3Encryption')['status'], 'UNKNOWN')
        self.assertEqual(next(f for f in rows if f['type'] == 'S3PublicAccess')['status'], 'FAIL')

    def test_s3_policy_denial_keeps_block_public_access_evidence(self):
        clients = self.s3_clients()
        clients['s3'].get_bucket_policy_status.side_effect = aws_error()
        rows = s3.scan(clients, 'us-east-1')
        self.assertEqual(next(f for f in rows if f['type'] == 'S3BlockPublicAccess')['status'], 'FAIL')
        self.assertEqual(next(f for f in rows if f['type'] == 'S3PublicAccess')['status'], 'UNKNOWN')

    def test_iam_api_only_user_skips_console_mfa(self):
        sdk = client(get_account_summary={'SummaryMap': {'AccountMFAEnabled': 1}},
                     list_users={'Users': [{'UserName': 'api-user'}]}, list_access_keys={'AccessKeyMetadata': []})
        sdk.get_login_profile.side_effect = aws_error('NoSuchEntity')
        rows = iam.scan({'iam': sdk, 'sts': client(get_caller_identity={'Account': '123456789012'})}, 'eu-west-1')
        self.assertEqual(next(f for f in rows if f['type'] == 'IAMUserMFA')['status'], 'SKIPPED')
        sdk.list_mfa_devices.assert_not_called()

    def test_iam_inventory_failure_preserves_root_evidence(self):
        sdk = client(get_account_summary={'SummaryMap': {'AccountMFAEnabled': 0}})
        sdk.list_users.side_effect = aws_error()
        rows = iam.scan({'iam': sdk, 'sts': client(get_caller_identity={'Account': '123456789012'})}, 'eu-west-1')
        self.assertEqual(next(f for f in rows if f['type'] == 'RootMFA')['status'], 'FAIL')
        self.assertTrue(any(f['status'] == 'UNKNOWN' for f in rows))

    def test_iam_keys_cover_all_users_and_only_stale_active_keys_fail(self):
        now = datetime.now(timezone.utc)
        sdk = client(get_account_summary={'SummaryMap': {'AccountMFAEnabled': 1}},
                     list_users={'Users': [{'UserName': 'alice'}, {'UserName': 'bob'}]},
                     get_login_profile={}, list_mfa_devices={'MFADevices': []}, get_access_key_last_used={'AccessKeyLastUsed': {}})
        sdk.list_access_keys.side_effect = [
            {'AccessKeyMetadata': [{'AccessKeyId': 'old', 'Status': 'Active', 'CreateDate': now - timedelta(days=100)}]},
            {'AccessKeyMetadata': [{'AccessKeyId': 'new', 'Status': 'Active', 'CreateDate': now}, {'AccessKeyId': 'inactive', 'Status': 'Inactive'}]}]
        rows = iam.scan({'iam': sdk, 'sts': client(get_caller_identity={'Account': '123456789012'})}, 'eu-west-1')
        keys = {f['resource']: f for f in rows if f['type'] == 'IAMUnusedAccessKey'}
        self.assertEqual({k: f['status'] for k, f in keys.items()}, {'old': 'FAIL', 'new': 'PASS', 'inactive': 'PASS'})
        self.assertEqual(keys['old']['user_name'], 'alice')

    def test_ec2_checks_groups_even_when_instance_inventory_is_denied(self):
        sdk = client(describe_security_groups={'SecurityGroups': [{'GroupId': 'sg-1', 'IpPermissions': [
            {'IpProtocol': 'tcp', 'FromPort': 22, 'ToPort': 22, 'Ipv6Ranges': [{'CidrIpv6': '::/0'}]}]}]})
        sdk.describe_instances.side_effect = aws_error()
        rows = ec2.scan({'ec2': sdk}, 'eu-west-1')
        self.assertEqual(next(f for f in rows if f['type'] == 'SecurityGroupOpen')['status'], 'FAIL')
        self.assertTrue(any(f['status'] == 'UNKNOWN' for f in rows))

    def test_ec2_rules_have_distinct_stable_ids_and_port_severities(self):
        sdk = client(describe_instances={'Reservations': []}, describe_security_groups={'SecurityGroups': [
            {'GroupId': 'sg-1', 'IpPermissions': [
                {'IpProtocol': 'tcp', 'FromPort': p, 'ToPort': p, 'IpRanges': [{'CidrIp': '0.0.0.0/0'}]} for p in (22, 443)]}]})
        rows = ec2.scan({'ec2': sdk}, 'eu-west-1')
        self.assertEqual(len({f['id'] for f in rows}), 2)
        self.assertEqual([f['severity'] for f in rows], ['critical', 'low'])
        self.assertEqual([f['id'] for f in rows], [f['id'] for f in ec2.scan({'ec2': sdk}, 'eu-west-1')])

    def test_rds_records_passes_and_failures(self):
        sdk = client(describe_db_instances={'DBInstances': [
            {'DBInstanceIdentifier': 'db-1', 'Engine': 'postgres', 'PubliclyAccessible': True, 'StorageEncrypted': True}]})
        self.assertEqual([f['status'] for f in rds.scan({'rds': sdk}, 'eu-west-1')], ['FAIL', 'PASS'])

    def lambda_client(self, statements=()):
        arn = 'arn:aws:lambda:eu-west-1:123456789012:function:demo'
        return client(list_functions={'Functions': [{'FunctionName': 'demo', 'FunctionArn': arn, 'Runtime': 'python3.8'}]},
                      get_policy={'Policy': json.dumps({'Statement': list(statements)})}, get_function_url_config={'AuthType': 'NONE'})

    def test_lambda_none_auth_without_both_grants_is_unknown(self):
        rows = lambda_checks.scan({'lambda': self.lambda_client()}, 'eu-west-1')
        self.assertEqual(next(f for f in rows if f['type'] == 'LambdaPublicFunctionURL')['status'], 'UNKNOWN')

    def test_lambda_public_grants_and_deprecated_runtime_correlate(self):
        sdk = self.lambda_client([{'Effect': 'Allow', 'Principal': '*', 'Action': ['lambda:InvokeFunctionUrl', 'lambda:InvokeFunction'], 'Resource': '*'}])
        rows = lambda_checks.scan({'lambda': sdk}, 'eu-west-1')
        self.assertTrue(all(f['status'] == 'FAIL' for f in rows))
        self.assertEqual(len(find_compound_risks(rows)), 1)

    def test_lambda_conditional_policy_requires_manual_evaluation(self):
        sdk = self.lambda_client([{'Effect': 'Allow', 'Principal': '*', 'Action': 'lambda:InvokeFunction', 'Resource': '*',
                                  'Condition': {'StringEquals': {'aws:SourceAccount': '123456789012'}}}])
        rows = lambda_checks.scan({'lambda': sdk}, 'eu-west-1')
        self.assertEqual(next(f for f in rows if f['type'] == 'LambdaPublicInvokePermission')['status'], 'UNKNOWN')

    def test_lambda_missing_url_is_skipped(self):
        sdk = self.lambda_client()
        sdk.get_function_url_config.side_effect = aws_error('ResourceNotFoundException')
        rows = lambda_checks.scan({'lambda': sdk}, 'eu-west-1')
        self.assertEqual(next(f for f in rows if f['type'] == 'LambdaPublicFunctionURL')['status'], 'SKIPPED')

    def test_lambda_url_denial_keeps_direct_invoke_policy_evidence(self):
        sdk = self.lambda_client([{'Effect': 'Allow', 'Principal': '*', 'Action': 'lambda:InvokeFunction', 'Resource': '*'}])
        sdk.get_function_url_config.side_effect = aws_error()
        rows = lambda_checks.scan({'lambda': sdk}, 'eu-west-1')
        self.assertEqual(next(f for f in rows if f['type'] == 'LambdaPublicInvokePermission')['status'], 'FAIL')
        self.assertEqual(next(f for f in rows if f['type'] == 'LambdaPublicFunctionURL')['status'], 'UNKNOWN')


class ReportTests(unittest.TestCase):
    def test_incomplete_scan_keeps_failures_and_marks_score_provisional(self):
        with patch.dict(audit.SCANNERS, {'s3': Mock(return_value=[finding()]), 'iam': Mock(side_effect=aws_error())}):
            report = audit.build_audit_report(report_task(('s3', 'iam')), {})
        self.assertTrue(report['partial'])
        self.assertTrue(report['score_provisional'])
        self.assertEqual(report['check_summary']['fail'], 1)
        self.assertEqual(report['check_summary']['unknown'], 1)
        self.assertEqual(report['risk_score'], 85)

    def test_all_unknown_or_empty_scans_have_no_score(self):
        for scanner in [Mock(side_effect=aws_error()), Mock(return_value=[])]:
            with self.subTest(scanner=scanner), patch.dict(audit.SCANNERS, {'s3': scanner}):
                report = audit.build_audit_report(report_task(), {})
            self.assertIsNone(report['risk_score'])
            self.assertIsNone(report['risk_grade'])

    def test_floci_does_not_claim_real_root_mfa_posture(self):
        with patch.dict(audit.SCANNERS, {'iam': Mock(return_value=[finding('RootMFA', category='IAM')])}):
            report = audit.build_audit_report(report_task(('iam',), 'floci'), {}, mode='floci')
        self.assertEqual(report['findings'][0]['status'], 'SKIPPED')
        self.assertIsNone(report['risk_score'])

    def test_previous_report_requires_identical_scope(self):
        previous = {'context': report_task()['context'], 'findings': []}
        previous['context']['region'] = 'us-east-1'
        with patch.dict(audit.SCANNERS, {'s3': Mock(return_value=[finding()])}):
            report = audit.build_audit_report(report_task(), {}, previous_report=previous)
        self.assertFalse(report['diff']['has_previous_scan'])

    def test_compliance_worst_outcome_wins(self):
        rows = [finding('RootMFA', status, resource=str(i), category='IAM') for i, status in enumerate(('PASS', 'UNKNOWN', 'FAIL'))]
        summary = compute_cis_summary(annotate_findings_with_cis(rows))
        self.assertEqual(summary['controls_assessed'], 1)
        self.assertEqual(summary['controls_failing'], 1)
        self.assertEqual(summary['controls_passing'], 0)

    def test_compliance_does_not_map_partial_key_or_unrelated_port_checks(self):
        self.assertIsNone(map_finding_to_cis(finding('IAMUnusedAccessKey', category='IAM')))
        for port, expected in [(443, None), (22, '5.2')]:
            with self.subTest(port=port):
                mapping = map_finding_to_cis(finding('SecurityGroupOpen', category='EC2', rule={'protocol': 'tcp', 'from_port': port, 'to_port': port}))
                self.assertEqual(mapping['control_id'] if mapping else None, expected)

    def test_correlations_do_not_double_count_risk(self):
        rows = [finding('S3PublicAccess'), finding('S3Encryption')]
        compounds = find_compound_risks(rows)
        self.assertEqual(len(compounds), 1)
        self.assertEqual({s['id'] for s in compounds[0]['correlates']}, {f['id'] for f in rows})
        self.assertEqual(compute_risk_score(rows + compounds), 70)
        self.assertEqual(score_to_grade(70), 'C')
        self.assertEqual(compute_risk_score([finding(resource=str(i)) for i in range(10)]), 0)

    def test_unknown_evidence_cannot_create_compound_risks(self):
        self.assertEqual(find_compound_risks([finding('S3PublicAccess', 'UNKNOWN'), finding()]), [])

    def test_public_instance_correlation_requires_matching_group_and_public_ip(self):
        rule = finding('SecurityGroupOpen', resource='sg-1', category='EC2', rule={'protocol': 'tcp', 'from_port': 22, 'to_port': 22})
        instance = finding('EC2Instance', 'SKIPPED', 'i-1', 'EC2', public_ip='192.0.2.1', security_groups=['sg-1'])
        self.assertEqual(len(find_compound_risks([rule, instance])), 1)
        instance['security_groups'] = ['sg-2']
        self.assertEqual(find_compound_risks([rule, instance]), [])
        instance.update(security_groups=['sg-1'], public_ip=None)
        self.assertEqual(find_compound_risks([rule, instance]), [])

    def test_diff_baseline_is_not_a_new_regression(self):
        rows = [finding()]
        diff = compute_diff(rows, None, 'first')
        self.assertFalse(diff['has_previous_scan'])
        self.assertEqual(diff['new_count'], 0)
        self.assertEqual(rows[0]['first_detected'], 'first')

    def test_diff_new_failure_and_explicit_resolution(self):
        old = [finding(status='PASS'), finding(resource='fixed')]
        rows = [finding(), finding(status='PASS', resource='fixed')]
        diff = compute_diff(rows, old, 'now')
        self.assertEqual(diff['new_count'], 1)
        self.assertEqual(diff['resolved_count'], 1)
        self.assertEqual(diff['persisting_count'], 0)

    def test_diff_unknown_service_does_not_resolve_missing_failures(self):
        diff = compute_diff([finding('s3Inventory', 'UNKNOWN', 'inventory')], [finding()], 'now')
        self.assertEqual(diff['resolved_count'], 0)
        self.assertEqual(diff['unobserved_count'], 1)

    def test_diff_unknown_source_does_not_resolve_its_compound_finding(self):
        old = [finding('S3PublicAccess'), finding('S3Encryption')]
        old.extend(find_compound_risks(old))
        diff = compute_diff([finding('s3Inventory', 'UNKNOWN', 'inventory')], old, 'now')
        self.assertEqual(diff['resolved_count'], 0)
        self.assertEqual(diff['unobserved_count'], 3)

    def test_diff_removed_ingress_resolves_compound_even_with_inventory_only_instance(self):
        rule = finding('SecurityGroupOpen', resource='sg-1', category='EC2', rule={'protocol': 'tcp', 'from_port': 22, 'to_port': 22})
        instance = finding('EC2Instance', 'SKIPPED', 'i-1', 'EC2', public_ip='192.0.2.1', security_groups=['sg-1'])
        old = [rule, instance]
        old.extend(find_compound_risks(old))
        diff = compute_diff([copy.deepcopy(instance)], old, 'now')
        self.assertEqual(diff['resolved_count'], 2)
        self.assertEqual(diff['unobserved_count'], 0)

    def test_diff_skipped_check_does_not_resolve_failure(self):
        diff = compute_diff([finding(status='SKIPPED')], [finding()], 'now')
        self.assertEqual(diff['unobserved_count'], 1)
        self.assertEqual(diff['resolved_count'], 0)

    def test_diff_preserves_first_detection_through_unknown_observation(self):
        old = [finding()]
        compute_diff(old, None, 'first')
        unknown = [finding(status='UNKNOWN')]
        compute_diff(unknown, old, 'second')
        current = [finding()]
        compute_diff(current, unknown, 'third')
        self.assertEqual(current[0]['first_detected'], 'first')
        self.assertEqual(current[0]['last_detected'], 'third')

    def test_diff_only_counts_ongoing_failures_as_persisting(self):
        old = [finding(), finding(status='PASS', resource='healthy')]
        self.assertEqual(compute_diff(copy.deepcopy(old), old, 'now')['persisting_count'], 1)


if __name__ == '__main__':
    unittest.main()
