import json
import os
import time
from datetime import datetime, timezone

import boto3
import psycopg2
import redis


REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")
DATABASE_URL = os.getenv("DATABASE_URL", "postgres://postgres:postgres@db:5432/cloud_sentinel")
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")


def get_redis_client():
    return redis.from_url(REDIS_URL)


def get_db_connection():
    return psycopg2.connect(DATABASE_URL)


def get_aws_clients():
    session = boto3.session.Session(region_name=AWS_REGION)
    return {
        "s3": session.client("s3"),
        "ec2": session.client("ec2"),
        "iam": session.client("iam"),
        "sts": session.client("sts"),
    }


def ensure_schema(conn):
    with conn.cursor() as cursor:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS audit_reports (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                task_id TEXT,
                report JSONB NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
    conn.commit()


def list_unencrypted_s3_buckets(s3_client):
    buckets = s3_client.list_buckets().get("Buckets", [])
    findings = []

    for bucket in buckets:
        bucket_name = bucket["Name"]
        try:
            encryption = s3_client.get_bucket_encryption(Bucket=bucket_name)
            rules = encryption["ServerSideEncryptionConfiguration"]["Rules"]
            findings.append({
                "bucket": bucket_name,
                "encrypted": True,
                "details": rules,
            })
        except Exception:
            findings.append({
                "bucket": bucket_name,
                "encrypted": False,
                "details": "No bucket encryption configuration found",
            })

    return findings


def list_running_ec2_instances(ec2_client):
    response = ec2_client.describe_instances(
        Filters=[{"Name": "instance-state-name", "Values": ["running"]}]
    )
    instances = []

    for reservation in response.get("Reservations", []):
        for instance in reservation.get("Instances", []):
            instances.append({
                "instance_id": instance.get("InstanceId"),
                "state": instance.get("State", {}).get("Name"),
                "type": instance.get("InstanceType"),
                "public_ip": instance.get("PublicIpAddress"),
            })

    return instances


def check_mfa_for_current_user(iam_client, sts_client):
    caller = sts_client.get_caller_identity()
    arn = caller.get("Arn", "")
    user_name = None

    if ":user/" in arn:
        user_name = arn.split("/", 1)[1]

    if not user_name:
        return {
            "enabled": False,
            "status": "unavailable",
            "details": "Current identity is not an IAM user",
        }

    response = iam_client.list_mfa_devices(UserName=user_name)
    enabled = len(response.get("MFADevices", [])) > 0
    return {
        "enabled": enabled,
        "status": "enabled" if enabled else "disabled",
        "user_name": user_name,
    }


def build_audit_report(task, aws_clients):
    return {
        "task_id": task.get("task_id"),
        "action": task.get("action"),
        "user_id": task["user_id"],
        "requested_at": task.get("requested_at") or datetime.now(timezone.utc).isoformat(),
        "scan": {
            "unencrypted_s3_buckets": list_unencrypted_s3_buckets(aws_clients["s3"]),
            "running_ec2_instances": list_running_ec2_instances(aws_clients["ec2"]),
            "mfa": check_mfa_for_current_user(aws_clients["iam"], aws_clients["sts"]),
        },
    }


def save_audit_report(conn, task, report):
    ensure_schema(conn)
    with conn.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO audit_reports (user_id, task_id, report)
            VALUES (%s, %s, %s)
            RETURNING id
            """,
            (task["user_id"], task.get("task_id"), json.dumps(report)),
        )
        report_id = cursor.fetchone()[0]
    conn.commit()
    return report_id


def process_task(task, aws_clients=None, conn=None):
    if task.get("action") != "start_audit":
        return {"status": "ignored", "reason": "unsupported action"}

    aws_clients = aws_clients or get_aws_clients()
    should_close_conn = conn is None
    conn = conn or get_db_connection()

    try:
        report = build_audit_report(task, aws_clients)
        report_id = save_audit_report(conn, task, report)
        return {"status": "ok", "report_id": report_id, "report": report}
    finally:
        if should_close_conn:
            conn.close()


def parse_task(payload):
    if isinstance(payload, bytes):
        payload = payload.decode("utf-8")
    return json.loads(payload)


def run_worker():
    client = get_redis_client()
    print("Worker started, listening for audit_tasks...")

    while True:
        try:
            item = client.brpop("audit_tasks", timeout=5)
            if not item:
                time.sleep(1)
                continue

            _, payload = item
            try:
                task = parse_task(payload)
            except Exception:
                print("Invalid task payload:", payload)
                continue

            result = process_task(task)
            print("Processed task:", result["status"], result.get("report_id"))
        except Exception as exc:
            print("Worker error:", exc)
            time.sleep(5)


def main():
    run_worker()


if __name__ == "__main__":
    main()
