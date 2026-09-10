"""Opt-in integration checks; each run creates and removes its own scratch database.

Set TEST_DATABASE_URL to a disposable PostgreSQL server with CREATEDB privileges.
No application database is modified. Requires the worker Python dependencies.
"""
import os
import sys
import time
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import psycopg2
from psycopg2 import sql
from psycopg2.extensions import make_dsn
from psycopg2.extras import Json

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'worker'))
import worker
from services.database import ensure_schema


@unittest.skipUnless(os.getenv('TEST_DATABASE_URL'), 'TEST_DATABASE_URL is not configured')
class DatabaseIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        for attempt in range(30):
            try:
                cls.admin = psycopg2.connect(os.environ['TEST_DATABASE_URL'], connect_timeout=2)
                break
            except psycopg2.OperationalError:
                if attempt == 29:
                    raise
                time.sleep(1)
        cls.admin.autocommit = True
        cls.name = 'sentinel_test_' + uuid.uuid4().hex
        with cls.admin.cursor() as cursor:
            cursor.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(cls.name)))
        cls.addClassCleanup(cls.remove_database)
        cls.dsn = make_dsn(os.environ['TEST_DATABASE_URL'], dbname=cls.name)
        conn = psycopg2.connect(cls.dsn)
        try:
            ensure_schema(conn)
            ensure_schema(conn)  # applying the same versions twice must be harmless
        finally:
            conn.close()

    @classmethod
    def remove_database(cls):
        try:
            with cls.admin.cursor() as cursor:
                cursor.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(cls.name)))
        finally:
            cls.admin.close()

    def connect(self):
        return psycopg2.connect(self.dsn, connect_timeout=5)

    def setUp(self):
        self.conn = self.connect()
        self.addCleanup(self.conn.close)
        with self.conn.cursor() as cursor:
            cursor.execute('TRUNCATE users CASCADE')
            cursor.execute("INSERT INTO users(email,password) VALUES ('owner@example.com','test-only') RETURNING id")
            self.owner = cursor.fetchone()[0]
        self.conn.commit()
        self.factory = patch.object(worker, 'get_db_connection', side_effect=self.connect)
        self.factory.start()
        self.addCleanup(self.factory.stop)

    def enqueue(self):
        task_id = str(uuid.uuid4())
        with self.conn.cursor() as cursor:
            cursor.execute('INSERT INTO audit_tasks(task_id,user_id,payload) VALUES (%s,%s,%s)',
                           (task_id, self.owner, Json({'region': 'eu-west-1', 'services': ['s3']})))
        self.conn.commit()
        return task_id

    def test_migration_ledger_and_single_owner_constraint(self):
        with self.conn.cursor() as cursor:
            cursor.execute('SELECT version FROM schema_migrations ORDER BY version')
            self.assertEqual([row[0] for row in cursor.fetchall()], ['001_baseline.sql', '002_durable_scans.sql'])
            with self.assertRaises(psycopg2.errors.UniqueViolation):
                cursor.execute("INSERT INTO users(email,password) VALUES ('second@example.com','test-only')")
        self.conn.rollback()

    def test_concurrent_workers_claim_different_tasks(self):
        queued = {self.enqueue(), self.enqueue()}
        def claim():
            conn = self.connect()
            try:
                return worker.claim_task(conn)
            finally:
                conn.close()
        with ThreadPoolExecutor(max_workers=2) as executor:
            rows = list(executor.map(lambda _: claim(), range(2)))
        self.assertEqual({row['task_id'] for row in rows}, queued)
        self.assertEqual(len({row['lease_token'] for row in rows}), 2)
        self.assertIsNone(worker.claim_task(self.conn))

    def test_expired_lease_cannot_renew_or_publish_after_recovery(self):
        self.enqueue()
        old = worker.claim_task(self.conn)
        with self.conn.cursor() as cursor:
            cursor.execute("UPDATE audit_tasks SET lease_until=NOW()-INTERVAL '1 second'")
        self.conn.commit()
        self.assertFalse(worker.renew_lease(old['task_id'], old['lease_token']))
        current = worker.claim_task(self.conn)
        self.assertEqual(current['attempts'], 2)
        self.assertNotEqual(current['lease_token'], old['lease_token'])
        self.assertIsNone(worker.complete_task(self.conn, old, {'findings': []}))
        report_id = worker.complete_task(self.conn, current, {'findings': [], 'partial': True})
        self.assertIsNotNone(report_id)
        self.assertIsNone(worker.complete_task(self.conn, current, {'findings': []}))
        with self.conn.cursor() as cursor:
            cursor.execute('SELECT count(*) FROM audit_reports')
            self.assertEqual(cursor.fetchone()[0], 1)
            cursor.execute('SELECT status,report_id FROM audit_tasks')
            self.assertEqual(cursor.fetchone(), ('partial', report_id))

    def test_failed_report_insert_rolls_back_before_retry(self):
        self.enqueue()
        row = worker.claim_task(self.conn)
        with self.assertRaises(psycopg2.errors.InvalidTextRepresentation):
            worker.complete_task(self.conn, row, {'invalid_json_number': float('nan')})
        worker.fail_task(self.conn, row, 'Invalid report')
        with self.conn.cursor() as cursor:
            cursor.execute('SELECT count(*) FROM audit_reports')
            self.assertEqual(cursor.fetchone()[0], 0)
            cursor.execute('SELECT status,lease_token,available_at>NOW() FROM audit_tasks')
            self.assertEqual(cursor.fetchone(), ('queued', None, True))

    def test_scheduler_preserves_scope_and_does_not_enqueue_twice(self):
        with self.conn.cursor() as cursor:
            cursor.execute("INSERT INTO aws_connections(user_id,role_arn,external_id) VALUES (%s,'arn:test','external') RETURNING id", (self.owner,))
            connection_id = cursor.fetchone()[0]
            cursor.execute("INSERT INTO scheduled_scans(user_id,interval_hours,connection_id,region,services) VALUES (%s,6,%s,'eu-west-1','[\"s3\"]')", (self.owner, connection_id))
        self.conn.commit()
        worker._check_due_schedules()
        worker._check_due_schedules()
        with self.conn.cursor() as cursor:
            cursor.execute('SELECT connection_id,payload FROM audit_tasks')
            rows = cursor.fetchall()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0][0], connection_id)
            self.assertEqual(rows[0][1]['services'], ['s3'])
            self.assertEqual(rows[0][1]['region'], 'eu-west-1')
            cursor.execute('SELECT next_run_at>NOW(),last_task_id FROM scheduled_scans')
            self.assertEqual(cursor.fetchone(), (True, rows[0][1]['task_id']))

    def test_owner_deletion_removes_tasks_reports_connections_and_schedules(self):
        self.enqueue()
        row = worker.claim_task(self.conn)
        worker.complete_task(self.conn, row, {'findings': []})
        with self.conn.cursor() as cursor:
            cursor.execute('DELETE FROM users WHERE id=%s', (self.owner,))
            for table in ('audit_tasks', 'audit_reports', 'aws_connections', 'scheduled_scans'):
                cursor.execute(sql.SQL('SELECT count(*) FROM {}').format(sql.Identifier(table)))
                self.assertEqual(cursor.fetchone()[0], 0)
        self.conn.commit()


if __name__ == '__main__':
    unittest.main(verbosity=2)
