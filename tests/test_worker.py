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
        self.assertEqual(conn.commits, 2)  # ensure_schema() + the insert
        # Caller supplied the connection, so process_task must not close it.
        self.assertFalse(conn.closed)
        self.assertIn("audit_reports", conn.cursor_obj.statements[0])

    def test_process_task_ignores_unknown_actions(self):
        result = worker.process_task({"action": "noop"})
        self.assertEqual(result["status"], "ignored")

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

    def test_parse_task_accepts_bytes_payload(self):
        payload = json.dumps({"action": "start_audit", "user_id": 1}).encode("utf-8")
        task = worker.parse_task(payload)
        self.assertEqual(task["user_id"], 1)

    def test_parse_task_accepts_str_payload(self):
        payload = json.dumps({"action": "start_audit", "user_id": 2})
        task = worker.parse_task(payload)
        self.assertEqual(task["user_id"], 2)


if __name__ == "__main__":
    unittest.main()
