import json
import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "worker"))

import worker
import services.audit as audit
from scans.iam import check_mfa_for_current_user


class FakeCursor:
    def __init__(self, fetchone_value=None, fetchall_value=None, fetchone_queue=None):
        self.statements = []
        self.params = []
        self.fetchone_value = fetchone_value
        self.fetchall_value = fetchall_value if fetchall_value is not None else []
        self.fetchone_queue = list(fetchone_queue) if fetchone_queue else None

    def execute(self, statement, params=None):
        self.statements.append(statement)
        self.params.append(params)

    def fetchone(self):
        if self.fetchone_queue is not None and len(self.fetchone_queue) > 0:
            return self.fetchone_queue.pop(0)
        return self.fetchone_value

    def fetchall(self):
        return self.fetchall_value

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class FakeConnection:
    def __init__(self, fetchone_value=(101,)):
        self.cursor_obj = FakeCursor(fetchone_value)
        self.commits = 0
        self.closed = False

    def cursor(self):
        return self.cursor_obj

    def commit(self):
        self.commits += 1

    def close(self):
        self.closed = True


def _fake_aws_clients():
    return {
        "s3": SimpleNamespace(),
        "ec2": SimpleNamespace(),
        "iam": SimpleNamespace(),
        "sts": SimpleNamespace(),
        "rds": SimpleNamespace(),
        "lambda": SimpleNamespace(),
    }


class WorkerTests(unittest.TestCase):
    def test_build_audit_report_combines_scan_results(self):
        task = {
            "action": "start_audit",
            "user_id": 7,
            "task_id": "task-1",
            "requested_at": "2026-05-06T05:00:00Z",
        }

        with patch.object(
            audit, "list_unencrypted_s3_buckets",
            return_value=[{"bucket": "demo", "encrypted": False, "details": "No encryption configured"}],
        ), patch.object(audit, "check_public_s3_buckets", return_value=[]), \
             patch.object(
                 audit, "list_running_ec2_instances",
                 return_value=[{"instance_id": "i-123", "state": "running", "type": "t3.micro"}],
             ), patch.object(audit, "check_open_security_groups", return_value=[]), \
             patch.object(
                 audit, "check_mfa_for_current_user",
                 return_value={"enabled": True, "status": "enabled", "user_name": "alice"},
             ), patch.object(audit, "check_root_mfa_enabled", return_value=[]):
            report = audit.build_audit_report(task, _fake_aws_clients(), mode="aws")

        self.assertEqual(report["user_id"], 7)
        s3_finding = next(f for f in report["findings"] if f["type"] == "S3Encryption")
        self.assertEqual(s3_finding["resource"], "demo")
        ec2_finding = next(f for f in report["findings"] if f["type"] == "EC2Instance")
        self.assertEqual(ec2_finding["resource"], "i-123")
        mfa_finding = next(f for f in report["findings"] if f["type"] == "IAMMFA")
        self.assertEqual(mfa_finding["severity"], "good")

    def test_build_audit_report_skips_root_mfa_in_floci_mode(self):
        task = {"action": "start_audit", "user_id": 9}

        with patch.object(audit, "list_unencrypted_s3_buckets", return_value=[]), \
             patch.object(audit, "check_public_s3_buckets", return_value=[]), \
             patch.object(audit, "list_running_ec2_instances", return_value=[]), \
             patch.object(audit, "check_open_security_groups", return_value=[]), \
             patch.object(
                 audit, "check_mfa_for_current_user",
                 return_value={"enabled": False, "status": "disabled", "user_name": "bob"},
             ):
            report = audit.build_audit_report(task, _fake_aws_clients(), mode="floci")

        root_finding = next(f for f in report["findings"] if f["type"] == "IAMRootMFA")
        self.assertEqual(root_finding["severity"], "info")

    def test_process_task_saves_report_and_closes_owned_connection(self):
        task = {"action": "start_audit", "user_id": 8, "task_id": "task-2"}
        conn = FakeConnection(fetchone_value=(55,))

        with patch.object(worker, "build_audit_report", return_value={"findings": []}):
            result = worker.process_task(task, conn=conn, aws_clients=_fake_aws_clients())

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["report_id"], 55)
        # ensure_schema() + "running" update + report insert + "done" update
        self.assertEqual(conn.commits, 4)
        # Caller supplied the connection, so process_task must not close it.
        self.assertFalse(conn.closed)
        self.assertTrue(any("audit_reports" in s for s in conn.cursor_obj.statements))
        status_updates = [s for s in conn.cursor_obj.statements if "UPDATE audit_tasks" in s]
        self.assertEqual(len(status_updates), 2)

    def test_process_task_ignores_unknown_actions(self):
        result = worker.process_task({"action": "noop"})
        self.assertEqual(result["status"], "ignored")

    def test_process_task_catches_aws_client_construction_failure(self):
        """Regression test: get_aws_clients() (e.g. a missing FLOCI_ENDPOINT)
        used to be called before the try block, so it escaped process_task
        entirely and crashed the whole worker loop instead of failing just
        this one task. It must come back as a normal {"status": "error"}."""
        task = {"action": "start_audit", "user_id": 12, "mode": "floci"}
        conn = FakeConnection()

        with patch.object(worker, "get_aws_clients", side_effect=ValueError("FLOCI_ENDPOINT not set")):
            result = worker.process_task(task, conn=conn)

        self.assertEqual(result["status"], "error")
        self.assertIn("FLOCI_ENDPOINT", result["error"])
        # Caller-supplied connection must still not be closed by process_task.
        self.assertFalse(conn.closed)

    def test_process_task_catches_db_connection_failure_without_crashing(self):
        """Same failure mode, but for get_db_connection() when no conn is
        supplied - must not raise AttributeError trying to close a None."""
        task = {"action": "start_audit", "user_id": 13}

        with patch.object(worker, "get_aws_clients", return_value=_fake_aws_clients()), \
             patch.object(worker, "get_db_connection", side_effect=OSError("could not connect to db")):
            result = worker.process_task(task)  # conn=None, should_close=True

        self.assertEqual(result["status"], "error")
        self.assertIn("could not connect", result["error"])

    def test_process_task_reports_errors_without_raising(self):
        task = {"action": "start_audit", "user_id": 11}
        conn = FakeConnection()

        with patch.object(worker, "build_audit_report", side_effect=RuntimeError("boom")):
            result = worker.process_task(task, conn=conn, aws_clients=_fake_aws_clients())

        self.assertEqual(result["status"], "error")
        self.assertIn("boom", result["error"])

    def test_check_mfa_for_current_user_handles_iam_user(self):
        sts = Mock()
        sts.get_caller_identity.return_value = {"Arn": "arn:aws:iam::123456789012:user/alice"}
        iam = Mock()
        iam.list_mfa_devices.return_value = {"MFADevices": [{"SerialNumber": "arn:..."}]}

        result = check_mfa_for_current_user(iam, sts)

        self.assertTrue(result["enabled"])
        self.assertEqual(result["user_name"], "alice")

    def test_check_mfa_for_current_user_handles_non_iam_caller(self):
        sts = Mock()
        sts.get_caller_identity.return_value = {"Arn": "arn:aws:sts::123456789012:assumed-role/Foo/session"}
        iam = Mock()

        result = check_mfa_for_current_user(iam, sts)

        self.assertFalse(result["enabled"])
        self.assertEqual(result["status"], "unavailable")

    def test_check_unused_access_keys_flags_never_used_and_stale_keys_account_wide(self):
        """Regression test: this check used to only look at the CALLING
        identity's own keys - it never saw other IAM users' keys at all,
        even ones created specifically to test this check."""
        from datetime import datetime, timedelta, timezone
        from scans.iam import check_unused_access_keys

        iam = Mock(spec=["list_users", "list_access_keys", "get_access_key_last_used"])
        iam.list_users.return_value = {"Users": [{"UserName": "alice"}, {"UserName": "bob"}]}

        def fake_list_keys(UserName):
            if UserName == "alice":
                return {"AccessKeyMetadata": [
                    {"AccessKeyId": "AKIA_NEVER_USED", "Status": "Active"},
                    {"AccessKeyId": "AKIA_STALE", "Status": "Active"},
                ]}
            return {"AccessKeyMetadata": [{"AccessKeyId": "AKIA_RECENT", "Status": "Active"}]}

        iam.list_access_keys.side_effect = fake_list_keys

        def fake_last_used(AccessKeyId):
            if AccessKeyId == "AKIA_NEVER_USED":
                return {"AccessKeyLastUsed": {}}
            if AccessKeyId == "AKIA_STALE":
                return {"AccessKeyLastUsed": {"LastUsedDate": datetime.now(timezone.utc) - timedelta(days=200)}}
            return {"AccessKeyLastUsed": {"LastUsedDate": datetime.now(timezone.utc) - timedelta(days=1)}}

        iam.get_access_key_last_used.side_effect = fake_last_used

        findings = check_unused_access_keys(iam)
        flagged = {f["resource"] for f in findings}

        self.assertIn("AKIA_NEVER_USED", flagged)  # alice's key, not the caller's
        self.assertIn("AKIA_STALE", flagged)
        self.assertNotIn("AKIA_RECENT", flagged)  # bob's key is recent - not flagged

    def test_check_unused_access_keys_handles_no_users(self):
        from scans.iam import check_unused_access_keys

        iam = Mock(spec=["list_users"])
        iam.list_users.return_value = {"Users": []}

        findings = check_unused_access_keys(iam)

        self.assertEqual(findings, [])

    def test_list_users_without_mfa_flags_only_users_lacking_a_device(self):
        from scans.iam import list_users_without_mfa

        iam = Mock(spec=["list_users", "list_mfa_devices"])
        iam.list_users.return_value = {"Users": [{"UserName": "alice"}, {"UserName": "bob"}]}

        def fake_mfa_devices(UserName):
            if UserName == "alice":
                return {"MFADevices": []}  # no MFA - should be flagged
            return {"MFADevices": [{"SerialNumber": "arn:..."}]}  # has MFA

        iam.list_mfa_devices.side_effect = fake_mfa_devices

        findings = list_users_without_mfa(iam)

        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["resource"], "alice")
        self.assertEqual(findings[0]["severity"], "critical")

    def test_list_users_without_mfa_returns_empty_when_everyone_has_mfa(self):
        from scans.iam import list_users_without_mfa

        iam = Mock(spec=["list_users", "list_mfa_devices"])
        iam.list_users.return_value = {"Users": [{"UserName": "alice"}]}
        iam.list_mfa_devices.return_value = {"MFADevices": [{"SerialNumber": "arn:..."}]}

        findings = list_users_without_mfa(iam)

        self.assertEqual(findings, [])

    def test_list_public_rds_instances_flags_publicly_accessible(self):
        from scans.rds import list_public_rds_instances

        rds = Mock(spec=["describe_db_instances"])  # no get_paginator, exercises non-paginated path
        rds.describe_db_instances.return_value = {
            "DBInstances": [
                {"DBInstanceIdentifier": "public-db", "PubliclyAccessible": True, "Engine": "postgres"},
                {"DBInstanceIdentifier": "private-db", "PubliclyAccessible": False, "Engine": "postgres"},
            ]
        }

        findings = list_public_rds_instances(rds)

        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["resource"], "public-db")
        self.assertEqual(findings[0]["severity"], "critical")

    def test_list_unencrypted_rds_instances_reports_encryption_status(self):
        from scans.rds import list_unencrypted_rds_instances

        rds = Mock(spec=["describe_db_instances"])
        rds.describe_db_instances.return_value = {
            "DBInstances": [
                {"DBInstanceIdentifier": "encrypted-db", "StorageEncrypted": True, "Engine": "mysql"},
                {"DBInstanceIdentifier": "plain-db", "StorageEncrypted": False, "Engine": "mysql"},
            ]
        }

        results = list_unencrypted_rds_instances(rds)
        by_id = {r["instance"]: r for r in results}

        self.assertTrue(by_id["encrypted-db"]["encrypted"])
        self.assertFalse(by_id["plain-db"]["encrypted"])

    def test_list_public_lambda_functions_flags_public_function_url(self):
        from scans.lambda_checks import list_public_lambda_functions

        lam = Mock(spec=["list_functions", "get_function_url_config", "get_policy"])
        lam.list_functions.return_value = {"Functions": [{"FunctionName": "public-fn"}]}
        lam.get_function_url_config.return_value = {
            "AuthType": "NONE", "FunctionUrl": "https://abc.lambda-url.us-east-1.on.aws/"
        }
        lam.get_policy.side_effect = Exception("no resource policy")

        findings = list_public_lambda_functions(lam)

        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["type"], "LambdaPublicFunctionURL")
        self.assertEqual(findings[0]["severity"], "critical")

    def test_list_public_lambda_functions_flags_public_resource_policy(self):
        from scans.lambda_checks import list_public_lambda_functions
        import json as _json

        lam = Mock(spec=["list_functions", "get_function_url_config", "get_policy"])
        lam.list_functions.return_value = {"Functions": [{"FunctionName": "open-fn"}]}
        lam.get_function_url_config.side_effect = Exception("no function url configured")
        lam.get_policy.return_value = {
            "Policy": _json.dumps({
                "Statement": [{"Effect": "Allow", "Principal": "*", "Action": "lambda:InvokeFunction"}]
            })
        }

        findings = list_public_lambda_functions(lam)

        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["type"], "LambdaPublicInvokePermission")

    def test_list_public_lambda_functions_ignores_private_functions(self):
        from scans.lambda_checks import list_public_lambda_functions

        lam = Mock(spec=["list_functions", "get_function_url_config", "get_policy"])
        lam.list_functions.return_value = {"Functions": [{"FunctionName": "private-fn"}]}
        lam.get_function_url_config.side_effect = Exception("no function url configured")
        lam.get_policy.side_effect = Exception("no resource policy")

        findings = list_public_lambda_functions(lam)

        self.assertEqual(findings, [])

    def test_check_deprecated_lambda_runtimes_flags_old_runtimes_only(self):
        from scans.lambda_checks import check_deprecated_lambda_runtimes

        lam = Mock(spec=["list_functions"])
        lam.list_functions.return_value = {
            "Functions": [
                {"FunctionName": "old-fn", "Runtime": "python3.7"},
                {"FunctionName": "current-fn", "Runtime": "python3.12"},
            ]
        }

        findings = check_deprecated_lambda_runtimes(lam)

        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["resource"], "old-fn")
        self.assertEqual(findings[0]["severity"], "medium")

    def test_open_security_group_flags_ssh_as_critical(self):
        from scans.ec2 import check_open_security_groups

        ec2 = Mock()
        ec2.describe_security_groups.return_value = {
            "SecurityGroups": [{
                "GroupId": "sg-ssh",
                "IpPermissions": [{
                    "IpProtocol": "tcp", "FromPort": 22, "ToPort": 22,
                    "IpRanges": [{"CidrIp": "0.0.0.0/0"}],
                }],
            }]
        }

        findings = check_open_security_groups(ec2)

        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["severity"], "critical")
        self.assertIn("SSH", findings[0]["title"])

    def test_open_security_group_flags_web_port_as_low(self):
        from scans.ec2 import check_open_security_groups

        ec2 = Mock()
        ec2.describe_security_groups.return_value = {
            "SecurityGroups": [{
                "GroupId": "sg-web",
                "IpPermissions": [{
                    "IpProtocol": "tcp", "FromPort": 443, "ToPort": 443,
                    "IpRanges": [{"CidrIp": "0.0.0.0/0"}],
                }],
            }]
        }

        findings = check_open_security_groups(ec2)

        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["severity"], "low")

    def test_open_security_group_flags_all_ports_as_critical(self):
        from scans.ec2 import check_open_security_groups

        ec2 = Mock()
        ec2.describe_security_groups.return_value = {
            "SecurityGroups": [{
                "GroupId": "sg-allports",
                "IpPermissions": [{
                    "IpProtocol": "-1",
                    "IpRanges": [{"CidrIp": "0.0.0.0/0"}],
                }],
            }]
        }

        findings = check_open_security_groups(ec2)

        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["severity"], "critical")
        self.assertIn("All ports", findings[0]["title"])

    def test_open_security_group_flags_wide_range_as_medium(self):
        from scans.ec2 import check_open_security_groups

        ec2 = Mock()
        ec2.describe_security_groups.return_value = {
            "SecurityGroups": [{
                "GroupId": "sg-wide",
                "IpPermissions": [{
                    # A wide range with no named risky/web port inside it,
                    # so this should hit the "wide range" branch, not
                    # "sensitive service exposed".
                    "IpProtocol": "tcp", "FromPort": 50000, "ToPort": 60000,
                    "IpRanges": [{"CidrIp": "0.0.0.0/0"}],
                }],
            }]
        }

        findings = check_open_security_groups(ec2)

        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["severity"], "medium")
        self.assertIn("Wide port range", findings[0]["title"])

    def test_open_security_group_ignores_rules_not_open_to_world(self):
        from scans.ec2 import check_open_security_groups

        ec2 = Mock()
        ec2.describe_security_groups.return_value = {
            "SecurityGroups": [{
                "GroupId": "sg-private",
                "IpPermissions": [{
                    "IpProtocol": "tcp", "FromPort": 22, "ToPort": 22,
                    "IpRanges": [{"CidrIp": "10.0.0.0/8"}],
                }],
            }]
        }

        findings = check_open_security_groups(ec2)

        self.assertEqual(findings, [])

    def test_open_security_group_detects_ipv6_world_exposure(self):
        from scans.ec2 import check_open_security_groups

        ec2 = Mock()
        ec2.describe_security_groups.return_value = {
            "SecurityGroups": [{
                "GroupId": "sg-v6",
                "IpPermissions": [{
                    "IpProtocol": "tcp", "FromPort": 3389, "ToPort": 3389,
                    "Ipv6Ranges": [{"CidrIpv6": "::/0"}],
                }],
            }]
        }

        findings = check_open_security_groups(ec2)

        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["severity"], "critical")
        self.assertIn("::/0", findings[0]["details"])

    def test_good_findings_use_pass_wording_not_fail_wording(self):
        """Regression test: several checks return both pass ("good") and
        fail ("critical") outcomes, but audit.py used to hardcode
        fail-oriented title/description/remediation regardless of which
        actually happened - e.g. a passing root-MFA check would still say
        "Root account without MFA is highly dangerous". Every "good"
        finding must actually describe a pass, not a failure."""
        task = {"action": "start_audit", "user_id": 5}

        with patch.object(audit, "list_unencrypted_s3_buckets", return_value=[
            {"bucket": "safe-bucket", "encrypted": True, "details": "AES256"}
        ]), patch.object(audit, "check_public_s3_buckets", return_value=[]), \
             patch.object(audit, "list_running_ec2_instances", return_value=[]), \
             patch.object(audit, "check_open_security_groups", return_value=[]), \
             patch.object(
                 audit, "check_mfa_for_current_user",
                 return_value={"enabled": True, "status": "enabled", "user_name": "alice"},
             ), patch.object(
                 audit, "check_root_mfa_enabled",
                 return_value=[{"type": "RootMFA", "resource": "123456789012", "severity": "good", "details": "Root MFA enabled"}],
             ), patch.object(
                 audit, "list_public_rds_instances", return_value=[]
             ), patch.object(
                 audit, "list_unencrypted_rds_instances",
                 return_value=[{"instance": "safe-db", "encrypted": True, "engine": "postgres"}],
             ):
            report = audit.build_audit_report(task, _fake_aws_clients(), mode="aws")

        good_findings = [f for f in report["findings"] if f["severity"] == "good"]
        self.assertEqual(len(good_findings), 4)  # s3, rds, user mfa, root mfa

        for f in good_findings:
            combined_text = " ".join([
                f.get("title", ""), f.get("description", ""),
                f.get("impact", ""), f.get("remediation", ""),
            ]).lower()
            for bad_phrase in ["not enabled", "disabled", "dangerous", "does not have", "immediately"]:
                self.assertNotIn(
                    bad_phrase, combined_text,
                    f"'good' finding {f['type']} still uses fail-oriented wording: {combined_text}",
                )

    def test_parse_task_accepts_bytes_payload(self):
        payload = json.dumps({"action": "start_audit", "user_id": 1}).encode("utf-8")
        task = worker.parse_task(payload)
        self.assertEqual(task["user_id"], 1)

    def test_parse_task_accepts_str_payload(self):
        payload = json.dumps({"action": "start_audit", "user_id": 2})
        task = worker.parse_task(payload)
        self.assertEqual(task["user_id"], 2)

    def test_handle_task_failure_requeues_with_incremented_retry_count(self):
        fake_client = Mock()
        task = {"action": "start_audit", "user_id": 3, "task_id": "t-1"}

        with patch.object(worker.time, "sleep"):
            worker.handle_task_failure(fake_client, task, "boom")

        fake_client.lpush.assert_called_once()
        queue_name, payload = fake_client.lpush.call_args[0]
        self.assertEqual(queue_name, "audit_tasks")
        requeued = json.loads(payload)
        self.assertEqual(requeued["_retries"], 1)

    def test_handle_task_failure_dead_letters_after_max_retries(self):
        fake_client = Mock()
        task = {
            "action": "start_audit",
            "user_id": 3,
            "task_id": None,  # avoid touching the real DB in this test
            "_retries": worker.MAX_TASK_RETRIES,
        }

        worker.handle_task_failure(fake_client, task, "still broken")

        fake_client.lpush.assert_called_once()
        queue_name, payload = fake_client.lpush.call_args[0]
        self.assertEqual(queue_name, worker.DEAD_LETTER_QUEUE)
        dead_lettered = json.loads(payload)
        self.assertEqual(dead_lettered["final_error"], "still broken")

    def test_check_due_schedules_enqueues_and_advances_next_run(self):
        conn = FakeConnection()
        conn.cursor_obj.fetchall_value = [(7, 42, "aws", 24)]  # one due schedule
        fake_redis = Mock()

        with patch.object(worker, "get_db_connection", return_value=conn), \
             patch.object(worker, "get_redis_client", return_value=fake_redis):
            worker._check_due_schedules()

        # Enqueued to Redis exactly like a manually-triggered scan
        fake_redis.lpush.assert_called_once()
        queue_name, payload = fake_redis.lpush.call_args[0]
        self.assertEqual(queue_name, "audit_tasks")
        task = json.loads(payload)
        self.assertEqual(task["user_id"], 42)
        self.assertEqual(task["mode"], "aws")
        self.assertEqual(task["params"]["schedule_id"], 7)

        # An audit_tasks row and a next_run_at advance were both written
        statements = " ".join(conn.cursor_obj.statements)
        self.assertIn("INSERT INTO audit_tasks", statements)
        self.assertIn("UPDATE scheduled_scans", statements)
        self.assertTrue(conn.closed)  # scheduler always owns its connection

    def test_check_due_schedules_does_nothing_when_none_are_due(self):
        conn = FakeConnection()
        conn.cursor_obj.fetchall_value = []
        fake_redis = Mock()

        with patch.object(worker, "get_db_connection", return_value=conn), \
             patch.object(worker, "get_redis_client", return_value=fake_redis):
            worker._check_due_schedules()

        fake_redis.lpush.assert_not_called()

    def test_get_aws_clients_assumes_role_when_role_arn_provided(self):
        fake_sts_for_assume = Mock()
        fake_sts_for_assume.assume_role.return_value = {
            "Credentials": {
                "AccessKeyId": "AKIAFAKE",
                "SecretAccessKey": "fake-secret",
                "SessionToken": "fake-token",
            }
        }
        fake_session = Mock()
        fake_session.client.return_value = Mock()

        with patch.object(worker.boto3, "client", return_value=fake_sts_for_assume), \
             patch.object(worker.boto3, "Session", return_value=fake_session) as mock_session_cls:
            clients = worker.get_aws_clients(
                "aws", role_arn="arn:aws:iam::123456789012:role/CloudSentinelScanRole", external_id="ext-123"
            )

        fake_sts_for_assume.assume_role.assert_called_once_with(
            RoleArn="arn:aws:iam::123456789012:role/CloudSentinelScanRole",
            RoleSessionName="cloud-sentinel-scan",
            ExternalId="ext-123",
            DurationSeconds=3600,
        )
        # The session must be built from the TEMPORARY credentials that came
        # back from assume_role, not the worker's own static credentials.
        _, session_kwargs = mock_session_cls.call_args
        self.assertEqual(session_kwargs["aws_access_key_id"], "AKIAFAKE")
        self.assertEqual(session_kwargs["aws_session_token"], "fake-token")
        self.assertIn("s3", clients)
        self.assertIn("lambda", clients)

    def test_get_aws_clients_uses_static_credentials_without_role_arn(self):
        """The legacy single-account path must keep working unchanged when
        no connection is involved - this is opt-in, not a breaking change."""
        fake_session = Mock()
        fake_session.client.return_value = Mock()

        with patch.object(worker.boto3, "Session", return_value=fake_session) as mock_session_cls:
            worker.get_aws_clients("aws")

        _, session_kwargs = mock_session_cls.call_args
        self.assertNotIn("aws_access_key_id", session_kwargs)

    def test_get_aws_connection_returns_none_when_not_found(self):
        conn = FakeConnection()
        conn.cursor_obj.fetchone_value = None

        result = worker.get_aws_connection(conn, 999, 1)

        self.assertIsNone(result)

    def test_get_aws_connection_returns_role_arn_and_external_id(self):
        conn = FakeConnection()
        conn.cursor_obj.fetchone_value = ("arn:aws:iam::123456789012:role/X", "ext-abc")

        result = worker.get_aws_connection(conn, 7, 1)

        self.assertEqual(result["role_arn"], "arn:aws:iam::123456789012:role/X")
        self.assertEqual(result["external_id"], "ext-abc")

    def test_process_task_looks_up_and_uses_the_connection(self):
        task = {"action": "start_audit", "user_id": 5, "connection_id": 9, "mode": "aws"}
        conn = FakeConnection()
        # First fetchone: the connection lookup. Second: the report INSERT.
        conn.cursor_obj.fetchone_queue = [
            ("arn:aws:iam::123456789012:role/X", "ext-abc"),
            (55,),
        ]

        with patch.object(worker, "get_aws_clients", return_value=_fake_aws_clients()) as mock_get_clients, \
             patch.object(worker, "build_audit_report", return_value={"findings": []}):
            result = worker.process_task(task, conn=conn)

        self.assertEqual(result["status"], "ok")
        mock_get_clients.assert_called_once_with(
            "aws", role_arn="arn:aws:iam::123456789012:role/X", external_id="ext-abc"
        )

    def test_process_task_fails_cleanly_on_unknown_connection(self):
        """An unknown/foreign connection_id must fail this one task through
        the normal error path, not raise an unhandled exception."""
        task = {"action": "start_audit", "user_id": 5, "connection_id": 999, "mode": "aws"}
        conn = FakeConnection()
        conn.cursor_obj.fetchone_value = None  # connection not found

        result = worker.process_task(task, conn=conn)

        self.assertEqual(result["status"], "error")
        self.assertIn("999", result["error"])

    def test_cis_mapping_root_mfa(self):
        from services.compliance import map_finding_to_cis

        mapping = map_finding_to_cis({"type": "RootMFA", "severity": "critical"})

        self.assertEqual(mapping["control_id"], "1.5")

    def test_cis_mapping_security_group_only_applies_to_ssh_rdp(self):
        from services.compliance import map_finding_to_cis

        ssh_finding = {"type": "SecurityGroupOpen", "title": "Sensitive service exposed: SSH (22)"}
        mysql_finding = {"type": "SecurityGroupOpen", "title": "Sensitive service exposed: MySQL (3306)"}
        web_finding = {"type": "SecurityGroupOpen", "title": "Web port 443 open to the internet"}

        self.assertEqual(map_finding_to_cis(ssh_finding)["control_id"], "5.2")
        # MySQL/web-port exposure is real and still flagged elsewhere, but
        # CIS 5.2 specifically means SSH/RDP ("remote server administration
        # ports") - it must not be misapplied to unrelated port exposures.
        self.assertIsNone(map_finding_to_cis(mysql_finding))
        self.assertIsNone(map_finding_to_cis(web_finding))

    def test_cis_mapping_returns_none_for_unmapped_types(self):
        """RDS/Lambda findings are real and useful, but they're not part of
        the actual CIS AWS Foundations Benchmark - must not be force-mapped."""
        from services.compliance import map_finding_to_cis

        for ftype in ["RDSEncryption", "RDSPubliclyAccessible", "LambdaPublicFunctionURL", "EC2Instance", "S3Encryption"]:
            self.assertIsNone(map_finding_to_cis({"type": ftype}))

    def test_compute_cis_summary_worst_outcome_wins_per_control(self):
        from services.compliance import compute_cis_summary, annotate_findings_with_cis

        findings = [
            {"type": "IAMUserMFA", "severity": "critical", "resource": "alice"},
            {"type": "IAMUserMFA", "severity": "good", "resource": "bob"},
            {"type": "RootMFA", "severity": "good"},
        ]
        annotate_findings_with_cis(findings)
        summary = compute_cis_summary(findings)

        self.assertEqual(summary["controls_assessed"], 2)  # 1.10 and 1.5
        self.assertEqual(summary["controls_passing"], 1)  # only 1.5 (root) passes
        self.assertEqual(summary["controls_failing"], 1)  # 1.10 fails (alice)

    def test_compute_risk_score_and_grade(self):
        from services.compliance import compute_risk_score, score_to_grade

        no_findings_score = compute_risk_score([])
        self.assertEqual(no_findings_score, 100)
        self.assertEqual(score_to_grade(no_findings_score), "A")

        bad_findings = [{"severity": "critical"}] * 4  # 4 * 15 = 60 penalty
        score = compute_risk_score(bad_findings)
        self.assertEqual(score, 40)
        self.assertEqual(score_to_grade(score), "D")

    def test_compute_risk_score_floors_at_zero(self):
        from services.compliance import compute_risk_score

        many_criticals = [{"severity": "critical"}] * 20  # way more than 100 penalty
        self.assertEqual(compute_risk_score(many_criticals), 0)

    def test_correlation_verified_remote_access_requires_matching_sg_and_public_ip(self):
        from services.correlation import find_compound_risks

        findings = [
            {"type": "SecurityGroupOpen", "resource": "sg-1", "title": "Sensitive service exposed: SSH (22)"},
            {"type": "EC2Instance", "resource": "i-1", "security_groups": ["sg-1"], "public_ip": "1.2.3.4"},
        ]
        compounds = find_compound_risks(findings)
        types = [c["type"] for c in compounds]
        self.assertIn("CompoundVerifiedRemoteAccess", types)

    def test_correlation_no_compound_without_public_ip(self):
        from services.correlation import find_compound_risks

        findings = [
            {"type": "SecurityGroupOpen", "resource": "sg-1", "title": "Sensitive service exposed: SSH (22)"},
            {"type": "EC2Instance", "resource": "i-1", "security_groups": ["sg-1"], "public_ip": None},
        ]
        compounds = find_compound_risks(findings)
        self.assertEqual(compounds, [])

    def test_correlation_no_mfa_anywhere(self):
        from services.correlation import find_compound_risks

        findings = [
            {"type": "RootMFA", "resource": "123456789012", "severity": "critical"},
            {"type": "IAMUserMFA", "resource": "alice", "severity": "critical"},
        ]
        compounds = find_compound_risks(findings)
        types = [c["type"] for c in compounds]
        self.assertIn("CompoundNoMFAAnywhere", types)

    def test_correlation_skips_no_mfa_anywhere_when_root_mfa_passes(self):
        from services.correlation import find_compound_risks

        findings = [
            {"type": "RootMFA", "resource": "123456789012", "severity": "good"},
            {"type": "IAMUserMFA", "resource": "alice", "severity": "critical"},
        ]
        compounds = find_compound_risks(findings)
        types = [c["type"] for c in compounds]
        self.assertNotIn("CompoundNoMFAAnywhere", types)

    def test_correlation_stale_key_without_mfa_matches_username_from_details(self):
        from services.correlation import find_compound_risks

        findings = [
            {"type": "IAMUnusedAccessKey", "resource": "AKIA123", "details": "Key for user 'alice' has never been used (status: Active)"},
            {"type": "IAMUserMFA", "resource": "alice", "severity": "critical"},
        ]
        compounds = find_compound_risks(findings)
        types = [c["type"] for c in compounds]
        self.assertIn("CompoundStaleKeyNoMFA", types)

    def test_correlation_s3_public_and_unencrypted(self):
        from services.correlation import find_compound_risks

        findings = [
            {"type": "S3PublicAccess", "resource": "my-bucket"},
            {"type": "S3Encryption", "resource": "my-bucket", "severity": "critical"},
        ]
        compounds = find_compound_risks(findings)
        types = [c["type"] for c in compounds]
        self.assertIn("CompoundS3PublicAccessAndS3Encryption", types)

    def test_correlation_lambda_public_and_deprecated(self):
        from services.correlation import find_compound_risks

        findings = [
            {"type": "LambdaPublicFunctionURL", "resource": "my-fn"},
            {"type": "LambdaDeprecatedRuntime", "resource": "my-fn"},
        ]
        compounds = find_compound_risks(findings)
        types = [c["type"] for c in compounds]
        self.assertIn("CompoundLambdaExposedAndOutdated", types)

    def test_correlation_every_compound_finding_lists_its_sources(self):
        """Nothing here should be a black box - every compound finding must
        trace back to the specific findings it was built from."""
        from services.correlation import find_compound_risks

        findings = [
            {"type": "RootMFA", "resource": "123456789012", "severity": "critical"},
            {"type": "IAMUserMFA", "resource": "alice", "severity": "critical"},
        ]
        compounds = find_compound_risks(findings)
        for c in compounds:
            self.assertIn("correlates", c)
            self.assertTrue(len(c["correlates"]) >= 1)

    def test_diff_marks_new_findings_when_no_previous_scan(self):
        from services.diffing import compute_diff

        current = [{"type": "S3PublicAccess", "resource": "bucket-a"}]
        diff = compute_diff(current, None)

        self.assertFalse(diff["has_previous_scan"])
        self.assertEqual(diff["new_count"], 0)
        self.assertFalse(current[0]["is_new"])  # nothing to compare against yet

    def test_diff_detects_new_and_resolved_findings(self):
        from services.diffing import compute_diff

        previous = [
            {"type": "S3PublicAccess", "resource": "bucket-a"},
            {"type": "SecurityGroupOpen", "resource": "sg-1"},
        ]
        current = [
            {"type": "S3PublicAccess", "resource": "bucket-a"},  # persisting
            {"type": "IAMUserMFA", "resource": "alice"},  # new
        ]

        diff = compute_diff(current, previous)

        self.assertTrue(diff["has_previous_scan"])
        self.assertEqual(diff["new_count"], 1)
        self.assertEqual(diff["resolved_count"], 1)  # sg-1 finding is gone
        self.assertEqual(diff["persisting_count"], 1)  # bucket-a persists
        self.assertFalse(current[0]["is_new"])
        self.assertTrue(current[1]["is_new"])

    def test_correlation_verified_remote_access(self):
        from services.correlation import find_compound_risks

        findings = [
            {"type": "SecurityGroupOpen", "resource": "sg-1", "title": "Sensitive service exposed: SSH (22)"},
            {"type": "EC2Instance", "resource": "i-1", "security_groups": ["sg-1"], "public_ip": "1.2.3.4"},
        ]
        compounds = find_compound_risks(findings)

        self.assertEqual(len(compounds), 1)
        self.assertEqual(compounds[0]["type"], "CompoundVerifiedRemoteAccess")
        self.assertEqual(compounds[0]["severity"], "critical")

    def test_correlation_skips_when_sg_not_attached_to_any_instance(self):
        from services.correlation import find_compound_risks

        findings = [
            {"type": "SecurityGroupOpen", "resource": "sg-1", "title": "Sensitive service exposed: SSH (22)"},
            {"type": "EC2Instance", "resource": "i-1", "security_groups": ["sg-2"], "public_ip": "1.2.3.4"},
        ]
        self.assertEqual(find_compound_risks(findings), [])

    def test_correlation_no_mfa_anywhere_requires_both_root_and_user(self):
        from services.correlation import find_compound_risks

        root_only = [{"type": "RootMFA", "resource": "123", "severity": "critical"}]
        self.assertEqual(find_compound_risks(root_only), [])

        both = root_only + [{"type": "IAMUserMFA", "resource": "alice", "severity": "critical"}]
        compounds = find_compound_risks(both)
        self.assertEqual(len(compounds), 1)
        self.assertEqual(compounds[0]["type"], "CompoundNoMFAAnywhere")

    def test_correlation_stale_key_without_mfa(self):
        from services.correlation import find_compound_risks

        findings = [
            {"type": "IAMUnusedAccessKey", "resource": "AKIA123", "severity": "medium",
             "details": "Key for user 'alice' has never been used (status: Active)"},
            {"type": "IAMUserMFA", "resource": "alice", "severity": "critical"},
        ]
        compounds = find_compound_risks(findings)

        self.assertEqual(len(compounds), 1)
        self.assertEqual(compounds[0]["type"], "CompoundStaleKeyNoMFA")
        self.assertEqual(compounds[0]["resource"], "alice")

    def test_correlation_s3_public_and_unencrypted(self):
        from services.correlation import find_compound_risks

        findings = [
            {"type": "S3PublicAccess", "resource": "my-bucket", "severity": "critical"},
            {"type": "S3Encryption", "resource": "my-bucket", "severity": "critical"},
        ]
        compounds = find_compound_risks(findings)

        self.assertEqual(len(compounds), 1)
        self.assertIn("my-bucket", compounds[0]["resource"])

    def test_correlation_lambda_public_and_deprecated(self):
        from services.correlation import find_compound_risks

        findings = [
            {"type": "LambdaPublicFunctionURL", "resource": "my-fn", "severity": "critical"},
            {"type": "LambdaDeprecatedRuntime", "resource": "my-fn", "severity": "medium"},
        ]
        compounds = find_compound_risks(findings)

        self.assertEqual(len(compounds), 1)
        self.assertEqual(compounds[0]["type"], "CompoundLambdaExposedAndOutdated")

    def test_diff_first_scan_has_no_previous(self):
        from services.diffing import compute_diff

        current = [{"type": "S3PublicAccess", "resource": "b1"}]
        result = compute_diff(current, None)

        self.assertFalse(result["has_previous_scan"])
        self.assertFalse(current[0]["is_new"])
        self.assertEqual(result["persisting_count"], 1)

    def test_diff_detects_new_and_resolved_findings(self):
        from services.diffing import compute_diff

        previous = [
            {"type": "S3PublicAccess", "resource": "b1"},
            {"type": "SecurityGroupOpen", "resource": "sg-1"},
        ]
        current = [
            {"type": "S3PublicAccess", "resource": "b1"},  # persists
            {"type": "IAMUnusedAccessKey", "resource": "AKIA1"},  # new
        ]

        result = compute_diff(current, previous)

        self.assertTrue(result["has_previous_scan"])
        self.assertEqual(result["new_count"], 1)
        self.assertEqual(result["resolved_count"], 1)  # SecurityGroupOpen sg-1 is gone
        self.assertEqual(result["persisting_count"], 1)
        self.assertFalse(current[0]["is_new"])
        self.assertTrue(current[1]["is_new"])


if __name__ == "__main__":
    unittest.main()
