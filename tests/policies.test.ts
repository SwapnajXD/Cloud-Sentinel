import { evaluatePolicy, parsePolicy, PolicyFinding } from '../gateway/src/lib/policies';

const source = `apiVersion: cloud-sentinel/v1
kind: Policy
metadata:
  name: public-critical-findings
  version: 1
spec:
  resource: finding
  filters:
    - field: status
      op: equals
      value: FAIL
    - field: severity
      op: in
      value: [critical, high]
  severity: high
  remediation: Review the finding evidence and restrict access.
`;

describe('read-only policy documents', () => {
  test('parses and normalizes a supported versioned policy', () => {
    const policy = parsePolicy(source);
    expect(policy.metadata).toEqual({ name: 'public-critical-findings', version: 1 });
    expect(policy.spec.filters).toHaveLength(2);
    expect(policy.spec.severity).toBe('high');
  });

  test.each([
    ['unsupported API version', source.replace('cloud-sentinel/v1', 'cloud-sentinel/v99')],
    ['unsupported field', source.replace('field: status', 'field: password')],
    ['unsupported operator', source.replace('op: equals', 'op: regex')],
    ['unsupported action-like key', source.replace('  resource: finding', '  resource: finding\n  actions: [delete]')],
  ])('rejects %s', (_label, document) => {
    expect(() => parsePolicy(document)).toThrow();
  });

  test('matches deterministically, explains matched fields, and ignores correlations', () => {
    const policy = parsePolicy(source);
    const findings: PolicyFinding[] = [
      { id: 'f-1', type: 'BucketPublic', category: 'S3', resource: 'bucket-a', severity: 'critical', status: 'FAIL' },
      { id: 'f-2', type: 'BucketPublic', category: 'S3', resource: 'bucket-b', severity: 'medium', status: 'FAIL' },
      { id: 'f-3', type: 'CompoundRisk', category: 'Correlated', resource: 'bucket-a', severity: 'critical', status: 'FAIL' },
    ];
    const expected = [{ finding_id: 'f-1', type: 'BucketPublic', resource: 'bucket-a', matched_on: [
      { field: 'status', op: 'equals', value: 'FAIL', actual: 'FAIL' },
      { field: 'severity', op: 'in', value: ['critical', 'high'], actual: 'critical' },
    ] }];
    expect(evaluatePolicy(policy, findings)).toEqual(expected);
    expect(evaluatePolicy(policy, findings)).toEqual(expected);
  });

  test('missing fields do not satisfy a negative match', () => {
    const policy = parsePolicy(source.replace('op: equals\n      value: FAIL', 'op: not_equals\n      value: PASS'));
    expect(evaluatePolicy(policy, [{ type: 'LegacyFinding', resource: 'legacy-resource' }])).toEqual([]);
    expect(evaluatePolicy(policy, [{ type: 'Check', resource: 'unknown-resource', status: 'UNKNOWN', severity: 'critical' }])).toEqual([]);
  });
});
