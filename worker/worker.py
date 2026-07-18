import json
import psycopg2
import os
import time
import sys
import threading
import uuid
import boto3
import redis
from datetime import datetime, timezone

# ✅ Fix Python path
sys.path.append(os.path.abspath(os.path.dirname(__file__)))

from services.audit import build_audit_report


# =========================
# ✅ Environment config
# =========================

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgres://postgres:postgres@db:5432/cloud_sentinel"
)

AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
FLOCI_ENDPOINT = os.getenv("FLOCI_ENDPOINT", None)

SCHEDULER_POLL_SECONDS = int(os.getenv("SCHEDULER_POLL_SECONDS", "60"))


# =========================
# ✅ Clients
# =========================
def get_redis_client():
    return redis.from_url(REDIS_URL)


def get_db_connection():
    return psycopg2.connect(DATABASE_URL)


def get_aws_clients(mode="aws"):
    session = boto3.Session(region_name=AWS_REGION)

    if mode == "floci":
        if not FLOCI_ENDPOINT:
            raise ValueError("FLOCI_ENDPOINT not set")

        print(f"[MODE] ⚡ Using FLOCI at {FLOCI_ENDPOINT}")

        return {
            "s3": session.client("s3", endpoint_url=FLOCI_ENDPOINT),
            "ec2": session.client("ec2", endpoint_url=FLOCI_ENDPOINT),
            "iam": session.client("iam", endpoint_url=FLOCI_ENDPOINT),
            "sts": session.client("sts", endpoint_url=FLOCI_ENDPOINT),
            "rds": session.client("rds", endpoint_url=FLOCI_ENDPOINT),
            "lambda": session.client("lambda", endpoint_url=FLOCI_ENDPOINT),
        }

    print("[MODE] ☁️ Using REAL AWS")

    return {
        "s3": session.client("s3"),
        "ec2": session.client("ec2"),
        "iam": session.client("iam"),
        "sts": session.client("sts"),
        "rds": session.client("rds"),
        "lambda": session.client("lambda"),
    }


# =========================
# ✅ Schema
# =========================
def ensure_schema(conn):
    with conn.cursor() as cursor:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS audit_reports (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                report JSONB NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_audit_reports_user_created
            ON audit_reports (user_id, created_at DESC)
            """
        )
        # Mirrors the table the gateway creates on startup. IF NOT EXISTS
        # makes this safe regardless of which service starts first.
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS audit_tasks (
                task_id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'queued',
                mode TEXT NOT NULL DEFAULT 'aws',
                report_id INTEGER REFERENCES audit_reports(id) ON DELETE SET NULL,
                error TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        # Mirrors the table the gateway creates for recurring scans.
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS scheduled_scans (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                mode TEXT NOT NULL DEFAULT 'aws',
                interval_hours INTEGER NOT NULL,
                next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
    conn.commit()


def update_task_status(conn, task_id, status, report_id=None, error=None):
    """Best-effort status update. Older/manually-queued tasks may not have a
    task_id (e.g. before this field existed) - silently skip those rather
    than failing the whole audit over a missing tracking row."""
    if not task_id:
        return

    with conn.cursor() as cursor:
        cursor.execute(
            """
            UPDATE audit_tasks
            SET status = %s, report_id = COALESCE(%s, report_id), error = %s, updated_at = NOW()
            WHERE task_id = %s
            """,
            (status, report_id, error, task_id),
        )
    conn.commit()


# =========================
# ✅ Save report
# =========================
def save_audit_report(conn, task, report):
    with conn.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO audit_reports (user_id, report)
            VALUES (%s, %s)
            RETURNING id
            """,
            (task["user_id"], json.dumps(report)),
        )
        report_id = cursor.fetchone()[0]

    conn.commit()
    return report_id


def get_latest_report(conn, user_id):
    """Returns the user's most recent report (already-parsed JSONB dict),
    or None if they have no prior scans. Called before a new scan runs, so
    "most recent" naturally means "the one before this one" - no
    special-casing needed."""
    with conn.cursor() as cursor:
        cursor.execute(
            "SELECT report FROM audit_reports WHERE user_id = %s ORDER BY created_at DESC LIMIT 1",
            (user_id,),
        )
        row = cursor.fetchone()
    return row[0] if row else None


# =========================
# ✅ Task processing
# =========================
def process_task(task, conn=None, aws_clients=None):
    if task.get("action") != "start_audit":
        return {"status": "ignored"}

    mode = task.get("mode", "aws")
    task_id = task.get("task_id")
    should_close = conn is None

    start_time = time.time()

    try:
        print("=" * 60)
        print(f"[TASK RECEIVED] {task}")
        print(f"[AUDIT START] user={task['user_id']} mode={mode}")

        # Built inside the try: a misconfigured FLOCI_ENDPOINT or an
        # unreachable DB should fail *this task* (and go through the normal
        # retry/dead-letter path below), not crash the whole worker loop.
        aws_clients = aws_clients or get_aws_clients(mode)
        conn = conn or get_db_connection()

        ensure_schema(conn)
        update_task_status(conn, task_id, "running")

        previous_report = get_latest_report(conn, task["user_id"])
        report = build_audit_report(task, aws_clients, mode=mode, previous_report=previous_report)

        findings = report.get("findings", []) if isinstance(report, dict) else []
        print(f"[FINDINGS] count={len(findings)}")

        report_id = save_audit_report(conn, task, report)
        update_task_status(conn, task_id, "done", report_id=report_id)

        duration = time.time() - start_time

        metrics = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "user_id": task["user_id"],
            "mode": mode,
            "report_id": report_id,
            "findings_count": len(findings),
            "duration_sec": round(duration, 2),
        }

        print(f"[AUDIT COMPLETE] report_id={report_id} time={duration:.2f}s")
        print(f"[METRICS] {json.dumps(metrics)}")
        print("=" * 60)

        return {"status": "ok", "report_id": report_id}

    except Exception as e:
        duration = time.time() - start_time
        print(f"[AUDIT ERROR] user={task['user_id']} error={str(e)}")
        print(f"[FAILED AFTER] {duration:.2f}s")
        return {"status": "error", "error": str(e)}

    finally:
        if should_close and conn is not None:
            conn.close()


def parse_task(payload):
    """Decode a raw Redis payload (bytes or str) into a task dict."""
    if isinstance(payload, bytes):
        payload = payload.decode("utf-8")
    return json.loads(payload)


MAX_TASK_RETRIES = int(os.getenv("MAX_TASK_RETRIES", "3"))
TASK_RETRY_DELAY_SECONDS = int(os.getenv("TASK_RETRY_DELAY_SECONDS", "5"))
DEAD_LETTER_QUEUE = "audit_tasks_dead"


def handle_task_failure(client, task, error_message):
    """Requeue a failed task with backoff up to MAX_TASK_RETRIES, then move
    it to a dead-letter list and mark it permanently failed in the DB rather
    than retrying (or silently dropping it) forever."""
    retries = task.get("_retries", 0)
    task_id = task.get("task_id")

    if retries < MAX_TASK_RETRIES:
        task = {**task, "_retries": retries + 1}
        print(
            f"[RETRY] task_id={task_id} attempt={retries + 1}/{MAX_TASK_RETRIES} "
            f"in {TASK_RETRY_DELAY_SECONDS}s"
        )
        time.sleep(TASK_RETRY_DELAY_SECONDS)
        client.lpush("audit_tasks", json.dumps(task))
        return

    print(f"[DEAD-LETTER] task_id={task_id} exceeded {MAX_TASK_RETRIES} retries: {error_message}")
    client.lpush(DEAD_LETTER_QUEUE, json.dumps({**task, "final_error": error_message}))

    if task_id:
        conn = get_db_connection()
        try:
            ensure_schema(conn)
            update_task_status(conn, task_id, "error", error=error_message)
        finally:
            conn.close()


# =========================
# ✅ Scheduler (recurring scans)
# =========================
def run_scheduler():
    """Runs in its own thread. Every SCHEDULER_POLL_SECONDS, checks for
    scheduled_scans rows that have come due and enqueues them exactly like
    a manually-triggered scan (same audit_tasks row, same Redis push) -
    scheduled and manual scans are indistinguishable once queued."""
    print(f"⏰ Scheduler started, polling every {SCHEDULER_POLL_SECONDS}s")

    while True:
        try:
            _check_due_schedules()
        except Exception as e:
            print(f"❌ Scheduler error: {e}")

        time.sleep(SCHEDULER_POLL_SECONDS)


def _check_due_schedules():
    conn = get_db_connection()
    redis_client = get_redis_client()

    try:
        ensure_schema(conn)

        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, user_id, mode, interval_hours
                FROM scheduled_scans
                WHERE next_run_at <= NOW()
                """
            )
            due = cursor.fetchall()

        for schedule_id, user_id, mode, interval_hours in due:
            task_id = str(uuid.uuid4())
            task = {
                "task_id": task_id,
                "action": "start_audit",
                "user_id": user_id,
                "requested_at": datetime.now(timezone.utc).isoformat(),
                "mode": mode,
                "params": {"scope": "scheduled", "schedule_id": schedule_id},
            }

            with conn.cursor() as cursor:
                cursor.execute(
                    "INSERT INTO audit_tasks (task_id, user_id, status, mode) VALUES (%s, %s, %s, %s)",
                    (task_id, user_id, "queued", mode),
                )
                cursor.execute(
                    "UPDATE scheduled_scans SET next_run_at = NOW() + make_interval(hours => %s) WHERE id = %s",
                    (interval_hours, schedule_id),
                )
            conn.commit()

            redis_client.lpush("audit_tasks", json.dumps(task))
            print(f"[SCHEDULED SCAN QUEUED] schedule_id={schedule_id} user={user_id} mode={mode} task_id={task_id}")
    finally:
        conn.close()


# =========================
# ✅ Worker loop
# =========================
def run_worker():
    client = get_redis_client()
    print("🚀 Worker started, listening for audit_tasks...")

    while True:
        try:
            item = client.brpop("audit_tasks", timeout=0)

            if item is None:
                continue

            _, payload = item
            task = parse_task(payload)

            result = process_task(task)
            print("[RESULT]", result)

            if result.get("status") == "error":
                handle_task_failure(client, task, result.get("error"))

        except redis.exceptions.TimeoutError:
            continue

        except Exception as e:
            print(f"❌ Worker crash: {e}")
            time.sleep(2)


# =========================
# ✅ Entry
# =========================
def main():
    scheduler_thread = threading.Thread(target=run_scheduler, daemon=True)
    scheduler_thread.start()

    run_worker()


if __name__ == "__main__":
    main()
