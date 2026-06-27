import json
import psycopg2
import os
import time
import sys
import boto3
import redis

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

# 👉 IMPORTANT: this should point to your homelab Floci
# Example: http://192.168.1.50:4566
FLOCI_ENDPOINT = os.getenv("FLOCI_ENDPOINT", None)


# =========================
# ✅ Clients
# =========================
def get_redis_client():
    return redis.from_url(REDIS_URL)


def get_db_connection():
    return psycopg2.connect(DATABASE_URL)


def get_aws_clients(mode="aws"):
    """
    mode = "aws"   → real AWS
    mode = "floci" → homelab AWS emulator
    """

    session = boto3.Session(region_name=AWS_REGION)

    if mode == "floci":
        if not FLOCI_ENDPOINT:
            raise ValueError("FLOCI_ENDPOINT not set")

        print(f"⚡ Using FLOCI at {FLOCI_ENDPOINT}")

        return {
            "s3": session.client("s3", endpoint_url=FLOCI_ENDPOINT),
            "ec2": session.client("ec2", endpoint_url=FLOCI_ENDPOINT),
            "iam": session.client("iam", endpoint_url=FLOCI_ENDPOINT),
            "sts": session.client("sts", endpoint_url=FLOCI_ENDPOINT),
        }

    print("☁️ Using REAL AWS")

    return {
        "s3": session.client("s3"),
        "ec2": session.client("ec2"),
        "iam": session.client("iam"),
        "sts": session.client("sts"),
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
    conn.commit()


# =========================
# ✅ Save report
# =========================
def save_audit_report(conn, task, report):
    ensure_schema(conn)

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


# =========================
# ✅ Task processing
# =========================
def process_task(task, conn=None):
    if task.get("action") != "start_audit":
        return {"status": "ignored"}

    mode = task.get("mode", "aws")  # ✅ default = AWS

    aws_clients = get_aws_clients(mode)

    should_close = conn is None
    conn = conn or get_db_connection()

    try:
        print("📥 Received task:", task)
        print(f"🔍 Running audit for user: {task['user_id']} (mode={mode})")

        report = build_audit_report(task, aws_clients, mode=mode)
        report_id = save_audit_report(conn, task, report)

        print(f"✅ Audit complete → report_id={report_id}")

        return {"status": "ok", "report_id": report_id}

    finally:
        if should_close:
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
            task = json.loads(payload.decode("utf-8"))

            result = process_task(task)
            print("✅ Processed:", result)

        except redis.exceptions.TimeoutError:
            continue
        except Exception as e:
            print(f"❌ Worker error: {e}")
            time.sleep(2)


# =========================
# ✅ Entry
# =========================
def main():
    run_worker()


if __name__ == "__main__":
    main()