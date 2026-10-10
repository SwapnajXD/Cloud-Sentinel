import { Finding, ReportRow } from '@/lib/api';
import { buildOfflineHtml, buildPortableJson } from '@/lib/exports';

const row = (findings: Finding[]): ReportRow => ({
  id: 7, created_at: '2026-10-08T12:00:00Z',
  report: {
    context: { account_id: '123456789012', connection_id: 3, region: 'us-east-1', mode: 'aws', services: ['ec2'] },
    assessment_note: 'Partial evidence only.',
    check_summary: { pass: 1, fail: 1, unknown: 1, skipped: 1 },
    partial: true, score_provisional: true, findings,
    requested_at: '2026-10-08T11:58:00Z', completed_at: '2026-10-08T12:00:00Z',
  },
});

it('builds a self-contained escaped HTML report that preserves unknown and skipped states', () => {
  const html = buildOfflineHtml(row([
    { id: 'unknown', type: 'Inventory', resource: '<script>alert(1)</script>', severity: 'info', status: 'UNKNOWN', details: 'Access denied' },
    { id: 'skipped', type: 'NotApplicable', resource: 'bucket', severity: 'good', status: 'SKIPPED', title: 'Not assessed' },
  ]));
  expect(html).toContain('UNKNOWN');
  expect(html).toContain('SKIPPED');
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  expect(html).not.toContain('<script>alert(1)</script>');
  expect(html).toContain('123456789012');
  expect(html).toContain('Started 2026-10-08T11:58:00Z');
});

it('removes credential-like and internal owner fields from portable JSON', () => {
  const input = row([{ id: 'f', type: 'Check', resource: 'bucket', severity: 'medium', status: 'FAIL', details: {
    password: 'hidden', session_token: 'hidden', access_key_id: 'hidden', external_id: 'hidden', note: 'safe',
  } }]);
  (input.report as unknown as Record<string, unknown>).user_id = 99;
  const report = buildPortableJson(input) as { report: Record<string, unknown> };
  expect(report.report.user_id).toBeUndefined();
  const serialized = JSON.stringify(report);
  expect(serialized).not.toMatch(/hidden|password|session_token|access_key_id|external_id/);
  expect(serialized).toContain('safe');
});

it('keeps the fictional data warning in exported HTML and JSON', () => {
  const input = row([]);
  input.report.demo = true;
  const html = buildOfflineHtml(input);
  expect(html).toContain('DEMO DATA · Fictional resources · No AWS account was scanned');
  expect((buildPortableJson(input).report as { demo: boolean }).demo).toBe(true);
});
