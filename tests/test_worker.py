import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import worker


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


class WorkerTests(unittest.TestCase):
    def test_build_audit_report_combines_scan_results(self):
        task = {
            "action": "start_audit",
            "user_id": 7,
            "task_id": "task-1",
            "requested_at": "2026-05-06T05:00:00Z",
        }
        aws_clients = {
            "s3": SimpleNamespace(),
            "ec2": SimpleNamespace(),
            "iam": SimpleNamespace(),
            "sts": SimpleNamespace(),
        }

        with patch.object(worker, "list_unencrypted_s3_buckets", return_value=[{"bucket": "demo", "encrypted": False}]), \
             patch.object(worker, "list_running_ec2_instances", return_value=[{"instance_id": "i-123", "state": "running"}]), \
             patch.object(worker, "check_mfa_for_current_user", return_value={"enabled": True, "status": "enabled"}):
            report = worker.build_audit_report(task, aws_clients)

        self.assertEqual(report["user_id"], 7)
        self.assertEqual(report["scan"]["unencrypted_s3_buckets"][0]["bucket"], "demo")
        self.assertEqual(report["scan"]["running_ec2_instances"][0]["instance_id"], "i-123")
        self.assertTrue(report["scan"]["mfa"]["enabled"])

    def test_process_task_saves_report_and_closes_owned_connection(self):
        task = {"action": "start_audit", "user_id": 8, "task_id": "task-2"}
        conn = FakeConnection(fetchone_value=(55,))
        aws_clients = {
            "s3": SimpleNamespace(),
            "ec2": SimpleNamespace(),
            "iam": SimpleNamespace(),
            "sts": SimpleNamespace(),
        }

        with patch.object(worker, "build_audit_report", return_value={"scan": {}}):
            result = worker.process_task(task, aws_clients=aws_clients, conn=conn)

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["report_id"], 55)
        self.assertEqual(conn.commits, 2)
        self.assertFalse(conn.closed)
        self.assertIn("audit_reports", conn.cursor_obj.statements[0])

    def test_process_task_ignores_unknown_actions(self):
        result = worker.process_task({"action": "noop"}, aws_clients={})
        self.assertEqual(result["status"], "ignored")

    def test_check_mfa_for_current_user_handles_iam_user(self):
        sts = Mock()
        sts.get_caller_identity.return_value = {"Arn": "arn:aws:iam::123456789012:user/alice"}
        iam = Mock()
        iam.list_mfa_devices.return_value = {"MFADevices": [{"SerialNumber": "arn:..."}]}

        result = worker.check_mfa_for_current_user(iam, sts)

        self.assertTrue(result["enabled"])
        self.assertEqual(result["user_name"], "alice")

    def test_parse_task_accepts_bytes_payload(self):
        payload = json.dumps({"action": "start_audit", "user_id": 1}).encode("utf-8")
        task = worker.parse_task(payload)
        self.assertEqual(task["user_id"], 1)


if __name__ == "__main__":
    unittest.main()
