import { buildSarif } from '../gateway/src/lib/exports';

describe('SARIF report export', () => {
  test('uses stable rules, preserves unknown and skipped states, and omits passed checks as results', () => {
    const result = buildSarif({
      schema_version: 2, partial: true, score_provisional: true,
      requested_at: '2026-10-01T09:00:00Z', completed_at: '2026-10-01T09:02:00Z',
      context: { account_id: '123456789012', region: 'us-east-1' },
      coverage: [{ service: 'ec2', status: 'UNKNOWN', checks: 2 }],
      check_summary: { pass: 1, fail: 1, unknown: 1, skipped: 1 },
      findings: [
        { id: 'f1', type: 'PublicBucket', title: 'Public bucket', category: 'S3', resource: 'bucket-a', status: 'FAIL', severity: 'critical', details: 'Policy grants public reads.' },
        { id: 'f2', type: 'Inventory', category: 'EC2', resource: 'instances', status: 'UNKNOWN', severity: 'info', details: { observed: 'none', session_token: 'do-not-export' } },
        { id: 'f3', type: 'NotApplicable', category: 'EC2', resource: 'host-check', status: 'SKIPPED', severity: 'good' },
        { id: 'f4', type: 'SecureBucket', category: 'S3', resource: 'bucket-b', status: 'PASS', severity: 'good' },
        { id: 'f5', type: 'CompoundRisk', category: 'Correlated', resource: 'bucket-a', status: 'FAIL', severity: 'critical' },
      ],
    }) as { runs: { results: { ruleId: string; kind: string; properties: { status: string } }[]; properties: Record<string, unknown> }[] };
    const run = result.runs[0];
    expect(run.results.map(row => [row.ruleId, row.kind, row.properties.status])).toEqual([
      ['cloud-sentinel/PublicBucket', 'fail', 'FAIL'],
      ['cloud-sentinel/Inventory', 'review', 'UNKNOWN'],
      ['cloud-sentinel/NotApplicable', 'notApplicable', 'SKIPPED'],
    ]);
    expect(run.properties.partial).toBe(true);
    expect(run.properties.coverage).toEqual([{ service: 'ec2', status: 'UNKNOWN', checks: 2 }]);
    expect(run.properties.requestedAt).toBe('2026-10-01T09:00:00Z');
    expect(run.properties.completedAt).toBe('2026-10-01T09:02:00Z');
    expect(JSON.stringify(run)).not.toContain('do-not-export');
  });
});
