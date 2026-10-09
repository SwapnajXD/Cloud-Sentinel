import { Finding, ReportRow } from '@/lib/api';
import { flattenReports, runReportQuery } from '@/lib/query';

const report = (id: number, created_at: string, findings: Finding[], account_id = '123456789012'): ReportRow => ({
  id, created_at, report: { completed_at: created_at, context: { account_id, connection_id: null, region: 'us-east-1', mode: 'aws', services: ['ec2'] }, findings },
});

describe('saved report query prototype', () => {
  const rows = flattenReports([
    report(2, '2026-10-08T12:00:00Z', [
      { id: 'f-2', type: 'BucketPublic', category: 'S3', resource: 'bucket-a', status: 'FAIL', severity: 'critical', title: 'Public bucket' },
      { id: 'unknown', type: 'BucketInventory', category: 'S3', resource: 'bucket-b', status: 'UNKNOWN', severity: 'info' },
    ]),
    report(1, '2026-10-07T12:00:00Z', [
      { id: 'f-1', type: 'BucketPublic', category: 'S3', resource: 'bucket-c', status: 'FAIL', severity: 'medium' },
      { id: 'pass', type: 'BucketPrivate', category: 'S3', resource: 'bucket-d', status: 'PASS', severity: 'good' },
    ], '999999999999'),
  ]);

  it('filters across report snapshots, sorts, and projects chosen fields', () => {
    const result = runReportQuery(rows, "SELECT report_id, scanned_at, account_id, resource FROM findings WHERE status = 'FAIL' AND type CONTAINS 'public' ORDER BY scanned_at DESC LIMIT 10");
    expect(result.columns).toEqual(['report_id', 'scanned_at', 'account_id', 'resource']);
    expect(result.rows).toEqual([
      { report_id: 2, scanned_at: '2026-10-08T12:00:00Z', account_id: '123456789012', resource: 'bucket-a' },
      { report_id: 1, scanned_at: '2026-10-07T12:00:00Z', account_id: '999999999999', resource: 'bucket-c' },
    ]);
  });

  it('does not let missing or unknown status satisfy negative filters', () => {
    const result = runReportQuery(rows, "SELECT finding_id FROM findings WHERE status != 'FAIL'");
    expect(result.rows.map(row => row.finding_id)).toEqual(['pass']);
  });

  it.each([
    'SELECT * FROM users',
    'SELECT * FROM findings; DROP TABLE reports',
    "SELECT * FROM findings WHERE status = 'FAIL' OR status = 'UNKNOWN'",
    'SELECT password FROM findings',
    'SELECT report_id FROM findings LIMIT 501',
    'SELECT * FROM findings ORDER BY type < 4',
  ])('rejects unsupported or unsafe query %s', query => {
    expect(() => runReportQuery(rows, query)).toThrow();
  });
});
