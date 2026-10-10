"""Generate or explicitly seed fictional reports; never calls AWS."""
import argparse
import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg2
from psycopg2.extras import Json

from scans.common import check
from services.compliance import annotate_findings_with_cis, compute_cis_summary, compute_risk_score, score_to_grade
from services.correlation import find_compound_risks
from services.diffing import compute_diff

DEMO_ACCOUNT = '000000000000'
DEMO_NOTE = ('DEMO DATA: Fictional resources and findings generated locally. '
             'No AWS account was scanned. Selected checks illustrate the product; this is not a security assessment or CIS certification.')
SERVICES = ['s3', 'ec2', 'iam', 'rds', 'lambda']
CONTEXT = {'account_id': DEMO_ACCOUNT, 'connection_id': None, 'region': 'us-east-1',
           'mode': 'aws', 'services': SERVICES, 'schema_version': 2}


def demo_findings(latest):
    bucket = 'demo-public-assets'
    sg = 'sg-demo-admin'
    rows = [
        check('RootMFA', 'IAM', 'account', 'PASS' if latest else 'FAIL', 'Root account MFA',
              'Fictional root MFA is enabled.' if latest else 'Fictional root MFA is disabled.',
              'Enable MFA on the root account.', region='global'),
        check('IAMUserMFA', 'IAM', 'demo-operator', 'FAIL', 'Console user lacks MFA',
              'Fictional console user demo-operator has no MFA device.', 'Require MFA for console users.',
              region='global', console_user=True),
        check('IAMUnusedAccessKey', 'IAM', 'demo-operator', 'FAIL', 'Unused access key',
              'A fictional access key has not been used for 120 days.', 'Disable unused keys.',
              region='global', user_name='demo-operator', identity='key-1', severity='medium'),
        check('S3BlockPublicAccess', 'S3', bucket, 'PASS' if latest else 'FAIL', 'S3 Block Public Access',
              'Fictional bucket-level Block Public Access is enabled.' if latest else 'Fictional bucket-level Block Public Access is disabled.',
              'Enable Block Public Access.', region='us-east-1'),
        check('S3PublicAccess', 'S3', bucket, 'FAIL', 'Public bucket policy',
              'A fictional bucket policy permits public reads.', 'Remove public access from the bucket policy.',
              region='us-east-1'),
        check('S3Encryption', 'S3', bucket, 'PASS' if latest else 'FAIL', 'Bucket default encryption',
              'Fictional bucket default encryption is enabled.' if latest else 'Fictional bucket default encryption is disabled.',
              'Enable default encryption.', region='us-east-1', severity='medium'),
        check('S3Encryption', 'S3', 'demo-private-logs', 'PASS', 'Bucket default encryption',
              'Fictional log bucket has default encryption enabled.', region='us-east-1'),
        check('SecurityGroupOpen', 'EC2', sg, 'FAIL', 'Administrative ingress open to the internet',
              'Fictional security group permits TCP 22 from 0.0.0.0/0.',
              'Restrict SSH ingress to approved source ranges.', region='us-east-1',
              rule={'protocol': 'tcp', 'from_port': 22, 'to_port': 22, 'cidrs': ['0.0.0.0/0']}),
        check('EC2Instance', 'EC2', 'i-demo-public', 'SKIPPED', 'Instance inventory',
              'Fictional running instance has a public IP and the observed security group.',
              region='us-east-1', security_groups=[sg], public_ip='192.0.2.10'),
        check('RDSPubliclyAccessible', 'RDS', 'demo-orders-db', 'FAIL', 'Public RDS instance',
              'Fictional RDS instance is configured as publicly accessible.',
              'Disable public accessibility.', region='us-east-1'),
        check('RDSEncryption', 'RDS', 'demo-orders-db', 'PASS', 'RDS storage encryption',
              'Fictional RDS storage encryption is enabled.', region='us-east-1'),
        check('LambdaPublicFunctionURL', 'Lambda', 'demo-webhook', 'UNKNOWN', 'Function URL policy unavailable',
              'Fictional Lambda policy evidence was unavailable; public access cannot be determined.',
              'Inspect the function URL policy.', region='us-east-1'),
    ]
    annotate_findings_with_cis(rows)
    rows.extend(find_compound_risks(rows))
    rows.sort(key=lambda f: ({'FAIL': 0, 'UNKNOWN': 1, 'PASS': 2, 'SKIPPED': 3}[f['status']],
                             {'critical': 0, 'medium': 1, 'low': 2}.get(f['severity'], 3), f['id']))
    return rows


def build_demo_reports(now=None):
    now = now or datetime.now(timezone.utc)
    result = []
    previous = None
    for index, observed_at in enumerate((now - timedelta(days=7), now)):
        findings = demo_findings(latest=index == 1)
        timestamp = observed_at.isoformat()
        diff = compute_diff(findings, previous['findings'] if previous else None, timestamp)
        checks = [f for f in findings if f['category'] != 'Correlated']
        counts = {state.lower(): sum(f['status'] == state for f in checks)
                  for state in ('PASS', 'FAIL', 'SKIPPED', 'UNKNOWN')}
        score = compute_risk_score(checks)
        task_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f'cloud-sentinel-demo-{index + 1}'))
        report = {'schema_version': 2, 'demo': True, 'task_id': task_id, 'action': 'start_audit',
                  'requested_at': (observed_at - timedelta(minutes=2)).isoformat(), 'completed_at': timestamp,
                  'duration_sec': 120, 'context': CONTEXT, 'connection_label': 'DEMO DATA · Fictional AWS account',
                  'coverage': [{'service': service, 'region': 'global' if service in ('s3', 'iam') else 'us-east-1',
                                'status': 'UNKNOWN' if any(f['category'].lower() == service and f['status'] == 'UNKNOWN' for f in checks) else 'ASSESSED',
                                'checks': sum(f['category'].lower() == service for f in checks)} for service in SERVICES],
                  'check_summary': counts, 'partial': counts['unknown'] > 0, 'score_provisional': counts['unknown'] > 0,
                  'assessment_note': DEMO_NOTE,
                  'summary': {'total': len(findings), **{s: sum(f['severity'] == s for f in findings) for s in ('critical', 'medium', 'low', 'good')}},
                  'risk_score': score, 'risk_grade': score_to_grade(score),
                  'cis_summary': compute_cis_summary(checks), 'diff': diff, 'findings': findings}
        result.append(report)
        previous = report
    return result


def seed_reports(reports):
    # A finished demo task is never claimed by the worker. Stable task IDs make reruns safe.
    conn = psycopg2.connect(os.getenv('DATABASE_URL', ''))
    try:
        with conn:
            with conn.cursor() as cursor:
                cursor.execute('SELECT id FROM users')
                owners = cursor.fetchall()
                if len(owners) != 1:
                    raise RuntimeError('Create the single dashboard owner before seeding demo data.')
                owner_id = owners[0][0]
                for report in reports:
                    task_id = report['task_id']
                    cursor.execute("SELECT user_id,payload->>'demo' FROM audit_tasks WHERE task_id=%s FOR UPDATE", (task_id,))
                    existing_task = cursor.fetchone()
                    cursor.execute("SELECT user_id,report->>'demo' FROM audit_reports WHERE task_id=%s FOR UPDATE", (task_id,))
                    existing_report = cursor.fetchone()
                    if (existing_task and existing_task != (owner_id, 'true')) or (existing_report and existing_report != (owner_id, 'true')):
                        raise RuntimeError('A demo task ID conflicts with non-demo data; no rows were changed.')
                    cursor.execute("""INSERT INTO audit_tasks(task_id,user_id,status,mode,connection_id,payload,progress,created_at,updated_at)
                        VALUES (%s,%s,%s,'aws',NULL,%s,'Fictional demo data',%s,%s) ON CONFLICT(task_id) DO NOTHING""",
                                   (task_id, owner_id, 'partial' if report['partial'] else 'done',
                                    Json({'demo': True, 'region': CONTEXT['region'], 'services': SERVICES}),
                                    report['requested_at'], report['completed_at']))
                    cursor.execute("""INSERT INTO audit_reports(user_id,task_id,report,created_at)
                        VALUES (%s,%s,%s,%s) ON CONFLICT(task_id) DO NOTHING RETURNING id""",
                                   (owner_id, task_id, Json(report), report['completed_at']))
                    inserted = cursor.fetchone()
                    if inserted:
                        cursor.execute('UPDATE audit_tasks SET report_id=%s WHERE task_id=%s AND user_id=%s',
                                       (inserted[0], task_id, owner_id))
        return len(reports)
    finally:
        conn.close()


def remove_reports(reports):
    conn = psycopg2.connect(os.getenv('DATABASE_URL', ''))
    try:
        with conn:
            with conn.cursor() as cursor:
                ids = [report['task_id'] for report in reports]
                cursor.execute("SELECT task_id FROM audit_reports WHERE task_id=ANY(%s) AND report->>'demo' IS DISTINCT FROM 'true'", (ids,))
                conflicting_reports = cursor.fetchall()
                cursor.execute("SELECT task_id FROM audit_tasks WHERE task_id=ANY(%s) AND payload->>'demo' IS DISTINCT FROM 'true'", (ids,))
                if conflicting_reports or cursor.fetchall():
                    raise RuntimeError('A demo task ID conflicts with non-demo data; no rows were removed.')
                cursor.execute("DELETE FROM audit_reports WHERE task_id=ANY(%s) AND report->>'demo'='true'", (ids,))
                cursor.execute("DELETE FROM audit_tasks WHERE task_id=ANY(%s) AND payload->>'demo'='true'", (ids,))
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description='Generate fictional Cloud-Sentinel reports without AWS access.')
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--output', type=Path, metavar='FILE', help='write the two sample reports as JSON')
    action.add_argument('--seed', action='store_true', help='insert reports for the existing owner in PostgreSQL')
    action.add_argument('--remove', action='store_true', help='remove only these fictional demo reports and tasks')
    args = parser.parse_args()
    reports = build_demo_reports()
    if args.output:
        args.output.write_text(json.dumps(reports, indent=2) + '\n', encoding='utf-8')
        print(f'Wrote {len(reports)} fictional reports to {args.output}')
    elif args.seed:
        seed_reports(reports)
        print('Demo reports are available for the existing dashboard owner (safe to rerun).')
    else:
        remove_reports(reports)
        print('Demo reports and tasks were removed.')


if __name__ == '__main__':
    main()
