const yaml = require('js-yaml') as { safeLoad(source: string): unknown };

export type PolicyFilter = {
  field: 'type' | 'category' | 'resource' | 'region' | 'severity' | 'status';
  op: 'equals' | 'not_equals' | 'contains' | 'in';
  value: string | string[];
};
export type PolicyDocument = {
  apiVersion: 'cloud-sentinel/v1';
  kind: 'Policy';
  metadata: { name: string; version: number; description?: string };
  spec: { resource: 'finding'; filters: PolicyFilter[]; severity?: 'critical' | 'high' | 'medium' | 'low' | 'info'; remediation?: string };
};
export type PolicyFinding = {
  id?: string; type: string; category?: string; resource: string; region?: string;
  severity?: string; status?: string;
};
export type PolicyMatch = {
  finding_id?: string; type: string; resource: string;
  matched_on: { field: PolicyFilter['field']; op: PolicyFilter['op']; value: string | string[]; actual: string }[];
};

const topKeys = ['apiVersion', 'kind', 'metadata', 'spec'];
const fields = new Set<PolicyFilter['field']>(['type', 'category', 'resource', 'region', 'severity', 'status']);
const operators = new Set<PolicyFilter['op']>(['equals', 'not_equals', 'contains', 'in']);
const severities = new Set(['critical', 'high', 'medium', 'low', 'info']);

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a mapping`);
  return value as Record<string, unknown>;
}
function onlyKeys(value: Record<string, unknown>, allowed: string[], label: string) {
  const unsupported = Object.keys(value).find(key => !allowed.includes(key));
  if (unsupported) throw new Error(`${label} contains unsupported field "${unsupported}"`);
}
function nonEmptyString(value: unknown, label: string, max = 300): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label} must be a non-empty string up to ${max} characters`);
  return value.trim();
}

export function parsePolicy(source: unknown): PolicyDocument {
  if (typeof source !== 'string' || !source.trim() || source.length > 20000) throw new Error('policy YAML must be between 1 and 20000 characters');
  let parsed: unknown;
  try { parsed = yaml.safeLoad(source); }
  catch { throw new Error('policy YAML could not be parsed'); }
  const root = object(parsed, 'policy');
  onlyKeys(root, topKeys, 'policy');
  if (root.apiVersion !== 'cloud-sentinel/v1') throw new Error('apiVersion must be cloud-sentinel/v1');
  if (root.kind !== 'Policy') throw new Error('kind must be Policy');
  const metadata = object(root.metadata, 'metadata');
  onlyKeys(metadata, ['name', 'version', 'description'], 'metadata');
  const name = nonEmptyString(metadata.name, 'metadata.name', 80);
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error('metadata.name must be a lowercase slug');
  if (!Number.isSafeInteger(metadata.version) || Number(metadata.version) < 1) throw new Error('metadata.version must be a positive integer');
  const description = metadata.description === undefined ? undefined : nonEmptyString(metadata.description, 'metadata.description', 300);
  const spec = object(root.spec, 'spec');
  onlyKeys(spec, ['resource', 'filters', 'severity', 'remediation'], 'spec');
  if (spec.resource !== 'finding') throw new Error('spec.resource must be finding');
  if (!Array.isArray(spec.filters) || spec.filters.length < 1 || spec.filters.length > 10) throw new Error('spec.filters must contain 1 to 10 filters');
  const filters = spec.filters.map((raw, index): PolicyFilter => {
    const filter = object(raw, `spec.filters[${index}]`);
    onlyKeys(filter, ['field', 'op', 'value'], `spec.filters[${index}]`);
    if (typeof filter.field !== 'string' || !fields.has(filter.field as PolicyFilter['field'])) throw new Error(`spec.filters[${index}].field is unsupported`);
    if (typeof filter.op !== 'string' || !operators.has(filter.op as PolicyFilter['op'])) throw new Error(`spec.filters[${index}].op is unsupported`);
    const op = filter.op as PolicyFilter['op'];
    let value: string | string[];
    if (op === 'in') {
      if (!Array.isArray(filter.value) || !filter.value.length || filter.value.length > 25) throw new Error(`spec.filters[${index}].value must contain 1 to 25 strings for "in"`);
      value = filter.value.map((item, i) => nonEmptyString(item, `spec.filters[${index}].value[${i}]`, 300));
    } else value = nonEmptyString(filter.value, `spec.filters[${index}].value`);
    return { field: filter.field as PolicyFilter['field'], op, value };
  });
  const severity = spec.severity === undefined ? undefined : nonEmptyString(spec.severity, 'spec.severity', 20);
  if (severity && !severities.has(severity)) throw new Error('spec.severity is unsupported');
  const remediation = spec.remediation === undefined ? undefined : nonEmptyString(spec.remediation, 'spec.remediation', 1000);
  return { apiVersion: 'cloud-sentinel/v1', kind: 'Policy', metadata: { name, version: Number(metadata.version), ...(description ? { description } : {}) },
    spec: { resource: 'finding', filters, ...(severity ? { severity: severity as PolicyDocument['spec']['severity'] } : {}), ...(remediation ? { remediation } : {}) } };
}

export function evaluatePolicy(policy: PolicyDocument, findings: PolicyFinding[]): PolicyMatch[] {
  return findings.filter(finding => finding.type && finding.resource && finding.category !== 'Correlated').flatMap(finding => {
    const matched = policy.spec.filters.map(filter => {
      const raw = finding[filter.field];
      if (typeof raw !== 'string') return null;
      const actual = raw;
      const expected = filter.value;
      if (filter.field === 'status' && ['UNKNOWN', 'SKIPPED'].includes(actual)
          && filter.op !== 'equals' && !(filter.op === 'in' && (expected as string[]).includes(actual))) return null;
      const ok = filter.op === 'equals' ? actual === expected
        : filter.op === 'not_equals' ? actual !== expected
          : filter.op === 'contains' ? actual.includes(expected as string)
            : (expected as string[]).includes(actual);
      return ok ? { field: filter.field, op: filter.op, value: expected, actual } : null;
    });
    if (matched.some(item => item === null)) return [];
    return [{ finding_id: finding.id, type: finding.type, resource: finding.resource,
      matched_on: matched as NonNullable<(typeof matched)[number]>[] }];
  });
}
