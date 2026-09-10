"""Postgres is the durable queue; Redis provides low-latency wakeups only.

Claims use SKIP LOCKED and renewable, fenced leases. Completing the report and
job in one transaction makes a retried delivery idempotent. An expired worker
can never publish results over a newer lease.
"""
import json
import os
import threading
import time
import uuid
from pathlib import Path
from datetime import datetime, timezone

import boto3
from botocore.config import Config
import psycopg2
from psycopg2.extras import RealDictCursor, Json
import redis

from services.database import ensure_schema
from services.audit import build_audit_report

DATABASE_URL = os.getenv('DATABASE_URL', '')
REDIS_URL = os.getenv('REDIS_URL', 'redis://localhost:6379')
AWS_REGION = os.getenv('AWS_REGION', 'us-east-1')
FLOCI_ENDPOINT = os.getenv('FLOCI_ENDPOINT')
MAX_TASK_RETRIES = max(0, int(os.getenv('MAX_TASK_RETRIES', '3')))
TASK_RETRY_DELAY_SECONDS = max(1, int(os.getenv('TASK_RETRY_DELAY_SECONDS', '5')))
SCHEDULER_POLL_SECONDS = max(1, int(os.getenv('SCHEDULER_POLL_SECONDS', '30')))
LEASE_SECONDS = max(30, int(os.getenv('JOB_LEASE_SECONDS', '120')))
WORKER_ID = str(uuid.uuid4())
SERVICES = ['s3', 'ec2', 'iam', 'rds', 'lambda']


def log(event, **fields):
    print(json.dumps({'timestamp': datetime.now(timezone.utc).isoformat(), 'event': event, **fields}), flush=True)


def safe_error(error):
    # SDK response messages can include URLs/policies. Log stable codes only.
    response = getattr(error, 'response', {})
    return response.get('Error', {}).get('Code', type(error).__name__)


def get_db_connection():
    return psycopg2.connect(DATABASE_URL, connect_timeout=5)


def get_redis_client():
    return redis.from_url(REDIS_URL, socket_connect_timeout=2, socket_timeout=5)


def get_aws_clients(mode='aws', role_arn=None, external_id=None, region=None):
    region = region or AWS_REGION
    config = Config(connect_timeout=5, read_timeout=15, retries={'max_attempts': 3, 'mode': 'standard'})
    if mode == 'floci':
        if not FLOCI_ENDPOINT:
            raise ValueError('FLOCI_ENDPOINT not set')
        session = boto3.Session(region_name=region, aws_access_key_id='testing', aws_secret_access_key='testing')
    elif role_arn:
        if not external_id:
            raise ValueError('External ID required')
        result = boto3.client('sts', region_name=region, config=config).assume_role(
            RoleArn=role_arn, ExternalId=external_id, RoleSessionName='cloud-sentinel-scan', DurationSeconds=3600)
        creds = result['Credentials']
        session = boto3.Session(region_name=region, aws_access_key_id=creds['AccessKeyId'],
                                aws_secret_access_key=creds['SecretAccessKey'], aws_session_token=creds['SessionToken'])
    else:
        session = boto3.Session(region_name=region)
    options = {'endpoint_url': FLOCI_ENDPOINT} if mode == 'floci' else {}
    return {service: session.client(service, config=config, **options) for service in SERVICES + ['sts', 's3control']}


def get_aws_connection(conn, connection_id, user_id):
    with conn.cursor(cursor_factory=RealDictCursor) as cursor:
        cursor.execute('SELECT role_arn,external_id,label FROM aws_connections WHERE id=%s AND user_id=%s AND active', (connection_id, user_id))
        return cursor.fetchone()


def parse_task(payload):
    return json.loads(payload.decode('utf-8') if isinstance(payload, bytes) else payload)


def claim_task(conn):
    """Recover expired leases and atomically claim one due task."""
    token = str(uuid.uuid4())
    with conn.cursor(cursor_factory=RealDictCursor) as cursor:
        cursor.execute("""UPDATE audit_tasks SET status=CASE WHEN attempts > %s THEN 'error' ELSE 'queued' END,
            error='Worker lease expired', progress='Recovering interrupted scan', lease_token=NULL,lease_until=NULL,updated_at=NOW()
            WHERE status='running' AND lease_until < NOW()""", (MAX_TASK_RETRIES,))
        cursor.execute("""WITH candidate AS (
            SELECT task_id FROM audit_tasks WHERE status='queued' AND available_at<=NOW()
            ORDER BY available_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1
        ) UPDATE audit_tasks t SET status='running',attempts=attempts+1,lease_token=%s,
            lease_until=NOW()+make_interval(secs=>%s),updated_at=NOW(),progress='Connecting to AWS',error=NULL
            FROM candidate c WHERE t.task_id=c.task_id RETURNING t.*""", (token, LEASE_SECONDS))
        row = cursor.fetchone()
    conn.commit()
    return dict(row) if row else None


def renew_lease(task_id, token, progress=None):
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("""UPDATE audit_tasks SET lease_until=NOW()+make_interval(secs=>%s),
                progress=COALESCE(%s,progress),updated_at=NOW() WHERE task_id=%s AND lease_token=%s AND status='running' AND lease_until>NOW()""",
                           (LEASE_SECONDS, progress, task_id, token))
            alive = cursor.rowcount == 1
        conn.commit()
        return alive
    finally:
        conn.close()


def complete_task(conn, row, report):
    """Fence stale workers, then persist report and terminal state atomically."""
    with conn.cursor() as cursor:
        cursor.execute("SELECT task_id FROM audit_tasks WHERE task_id=%s AND lease_token=%s AND status='running' AND lease_until>NOW() FOR UPDATE", (row['task_id'], row['lease_token']))
        if not cursor.fetchone():
            conn.rollback()
            return None
        cursor.execute('INSERT INTO audit_reports(user_id,task_id,report) VALUES (%s,%s,%s) ON CONFLICT(task_id) DO UPDATE SET task_id=EXCLUDED.task_id RETURNING id',
                       (row['user_id'], row['task_id'], Json(report)))
        report_id = cursor.fetchone()[0]
        cursor.execute("UPDATE audit_tasks SET status=%s,report_id=%s,progress='Assessment complete',lease_token=NULL,lease_until=NULL,updated_at=NOW() WHERE task_id=%s",
                       ('partial' if report.get('partial') else 'done', report_id, row['task_id']))
    conn.commit()
    return report_id


def fail_task(conn, row, error):
    conn.rollback()
    retry = row['attempts'] <= MAX_TASK_RETRIES
    delay = min(300, TASK_RETRY_DELAY_SECONDS * 2 ** (row['attempts'] - 1))
    with conn.cursor() as cursor:
        cursor.execute("""UPDATE audit_tasks SET status=%s,error=%s,progress=%s,available_at=NOW()+make_interval(secs=>%s),
            lease_token=NULL,lease_until=NULL,updated_at=NOW() WHERE task_id=%s AND lease_token=%s AND status='running'""",
                       ('queued' if retry else 'error', error, 'Waiting to retry' if retry else 'Scan failed', delay, row['task_id'], row['lease_token']))
    conn.commit()
    log('scan_retry' if retry else 'scan_failed', task_id=row['task_id'], attempt=row['attempts'], reason=error)


def get_latest_report(conn, user_id, context):
    with conn.cursor() as cursor:
        cursor.execute("SELECT report FROM audit_reports WHERE user_id=%s AND report->'context'=%s::jsonb ORDER BY created_at DESC LIMIT 1", (user_id, Json(context)))
        row = cursor.fetchone()
        return row[0] if row else None


def process_task(row, conn=None, aws_clients=None):
    owned = conn is None
    conn = conn or get_db_connection()
    task = dict(row['payload'])
    task.update(task_id=row['task_id'], user_id=row['user_id'], mode=row['mode'], connection_id=row['connection_id'])
    start = time.monotonic()
    stop = threading.Event()
    lost = threading.Event()

    def heartbeat():
        while not stop.wait(LEASE_SECONDS / 3):
            try:
                if not renew_lease(row['task_id'], row['lease_token']):
                    lost.set()
                    return
            except Exception:
                lost.set()  # conservative: don't publish if ownership cannot be established
                return

    thread = threading.Thread(target=heartbeat, daemon=True)
    thread.start()
    try:
        connection = None
        if task.get('connection_id') is not None:
            connection = get_aws_connection(conn, task['connection_id'], task['user_id'])
            if connection is None:
                raise ValueError('Selected AWS connection is disconnected or unavailable')
        clients = aws_clients or get_aws_clients(task['mode'], role_arn=connection['role_arn'] if connection else None,
                                                external_id=connection['external_id'] if connection else None, region=task.get('region'))
        identity = clients['sts'].get_caller_identity()
        context = {'account_id': identity['Account'], 'connection_id': task.get('connection_id'),
                   'region': task.get('region') or AWS_REGION, 'mode': task['mode'],
                   'services': sorted(task.get('services') or SERVICES), 'schema_version': 2}
        task['context'] = context
        task['connection_label'] = connection['label'] if connection else 'Worker identity'
        log('scan_started', task_id=row['task_id'], attempt=row['attempts'], **context)
        previous = get_latest_report(conn, task['user_id'], context)
        conn.commit()  # never hold a read transaction open throughout AWS calls

        def progress(service):
            if lost.is_set() or not renew_lease(row['task_id'], row['lease_token'], f'Checking {service.upper()}'):
                raise RuntimeError('Job lease lost')

        report = build_audit_report(task, clients, mode=task['mode'], previous_report=previous, progress=progress)
        report['duration_sec'] = round(time.monotonic() - start, 2)
        if lost.is_set():
            raise RuntimeError('Job lease lost')
        report_id = complete_task(conn, row, report)
        log('scan_completed' if report_id else 'scan_discarded', task_id=row['task_id'], report_id=report_id,
            duration_sec=report['duration_sec'], partial=report.get('partial'), **context)
        return {'status': 'ok' if report_id else 'stale', 'report_id': report_id}
    except Exception as error:
        reason = str(error) if isinstance(error, (ValueError, RuntimeError)) else safe_error(error)
        fail_task(conn, row, reason)
        return {'status': 'error', 'error': reason}
    finally:
        stop.set()
        thread.join(timeout=6)
        if owned:
            conn.close()


def _check_due_schedules():
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute("SELECT * FROM scheduled_scans WHERE enabled AND next_run_at<=NOW() ORDER BY next_run_at FOR UPDATE SKIP LOCKED LIMIT 100")
            for schedule in cursor.fetchall():
                task_id = str(uuid.uuid4())
                task = {'task_id': task_id, 'action': 'start_audit', 'user_id': schedule['user_id'],
                        'mode': schedule['mode'], 'connection_id': schedule['connection_id'],
                        'region': schedule['region'], 'services': schedule['services'],
                        'requested_at': datetime.now(timezone.utc).isoformat(), 'params': {'scope': 'selected-services', 'schedule_id': schedule['id']}}
                cursor.execute('INSERT INTO audit_tasks(task_id,user_id,mode,connection_id,payload) VALUES (%s,%s,%s,%s,%s)',
                               (task_id, schedule['user_id'], schedule['mode'], schedule['connection_id'], Json(task)))
                cursor.execute('UPDATE scheduled_scans SET next_run_at=NOW()+make_interval(hours=>interval_hours),last_run_at=NOW(),last_task_id=%s WHERE id=%s', (task_id, schedule['id']))
        conn.commit()  # durable jobs and schedule advancement commit together
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def maintenance():
    last_schedule = 0.0
    while True:
        try:
            conn = get_db_connection()
            try:
                with conn.cursor() as cursor:
                    cursor.execute('INSERT INTO worker_heartbeats(worker_id) VALUES (%s) ON CONFLICT(worker_id) DO UPDATE SET updated_at=NOW()', (WORKER_ID,))
                    cursor.execute("DELETE FROM worker_heartbeats WHERE updated_at<NOW()-INTERVAL '1 day'")
                conn.commit()
            finally:
                conn.close()
            Path(os.getenv('WORKER_HEARTBEAT_FILE', '/tmp/sentinel-worker-heartbeat')).touch()
            if time.monotonic() - last_schedule >= SCHEDULER_POLL_SECONDS:
                _check_due_schedules()
                last_schedule = time.monotonic()
        except Exception as error:
            log('maintenance_failed', reason=safe_error(error))
        time.sleep(min(20, SCHEDULER_POLL_SECONDS))


def main():
    while True:
        try:
            conn = get_db_connection()
            try:
                ensure_schema(conn)
            finally:
                conn.close()
            break
        except Exception as error:
            log('startup_failed', reason=safe_error(error))
            time.sleep(5)
    threading.Thread(target=maintenance, daemon=True).start()
    client = get_redis_client()
    log('worker_started', worker_id=WORKER_ID)
    while True:
        try:
            conn = get_db_connection()
            try:
                row = claim_task(conn)
                if row:
                    process_task(row, conn=conn)
                    continue
            finally:
                conn.close()
            try:
                client.brpop('audit_tasks', timeout=2)
            except redis.RedisError:
                time.sleep(2)
        except Exception as error:
            log('worker_iteration_failed', reason=safe_error(error))
            time.sleep(2)


if __name__ == '__main__':
    main()
