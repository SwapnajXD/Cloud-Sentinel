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
    def __init__(self, fetchone_value=None):
        self.statements = []
        self.params = []
        self.fetchone_value = fetchone_value

    def execute(self, statement, params=None):
        self.statements.append(statement)
        self.params.append(params)

    def fetchone(self):
        return self.fetchone_value

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
        self.assertIn("audit_reports", conn.cursor_obj.statements[0])
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

    def test_check_unused_access_keys_flags_never_used_and_stale_keys(self):
        from datetime import datetime, timedelta, timezone
        from scans.iam import check_unused_access_keys

        sts = Mock()
        sts.get_caller_identity.return_value = {"Arn": "arn:aws:iam::123456789012:user/alice"}
        iam = Mock()
        iam.list_access_keys.return_value = {
            "AccessKeyMetadata": [
                {"AccessKeyId": "AKIA_NEVER_USED", "Status": "Active"},
                {"AccessKeyId": "AKIA_STALE", "Status": "Active"},
                {"AccessKeyId": "AKIA_RECENT", "Status": "Active"},
            ]
        }

        def fake_last_used(AccessKeyId):
            if AccessKeyId == "AKIA_NEVER_USED":
                return {"AccessKeyLastUsed": {}}
            if AccessKeyId == "AKIA_STALE":
                return {"AccessKeyLastUsed": {"LastUsedDate": datetime.now(timezone.utc) - timedelta(days=200)}}
            return {"AccessKeyLastUsed": {"LastUsedDate": datetime.now(timezone.utc) - timedelta(days=1)}}

        iam.get_access_key_last_used.side_effect = fake_last_used

        findings = check_unused_access_keys(iam, sts)
        flagged = {f["resource"] for f in findings}

        self.assertIn("AKIA_NEVER_USED", flagged)
        self.assertIn("AKIA_STALE", flagged)
        self.assertNotIn("AKIA_RECENT", flagged)

    def test_check_unused_access_keys_skips_non_iam_callers(self):
        from scans.iam import check_unused_access_keys

        sts = Mock()
        sts.get_caller_identity.return_value = {"Arn": "arn:aws:sts::123456789012:assumed-role/Foo/session"}
        iam = Mock()

        findings = check_unused_access_keys(iam, sts)

        self.assertEqual(findings, [])
        iam.list_access_keys.assert_not_called()

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


if __name__ == "__main__":
    unittest.main()
