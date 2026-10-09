type JsonRecord = Record<string, unknown>;
const states = new Set(['PASS', 'FAIL', 'UNKNOWN', 'SKIPPED']);
const sensitiveKey = /password|secret|token|credential|external.?id|access.?key|user.?id/i;

function record(value: unknown): JsonRecord { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}; }
function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !sensitiveKey.test(key)).map(([key, child]) => [key, scrub(child)]));
  return value;
}
function safeText(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') { try { return JSON.stringify(scrub(value)); } catch { return fallback; } }
  return fallback;
}
function statusOf(finding: JsonRecord): string { return typeof finding.status === 'string' && states.has(finding.status) ? finding.status : 'UNKNOWN'; }
function stableFingerprint(finding: JsonRecord): string {
  if (typeof finding.id === 'string' && finding.id) return finding.id;
  const input = [finding.type, finding.resource, finding.region, finding.title].map(v => safeText(v)).join('|');
  let hash = 2166136261;
  for (let index = 0; index < input.length; index++) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
function sarifLevel(severity: string): 'error' | 'warning' | 'note' {
  if (severity === 'critical' || severity === 'high') return 'error';
  if (severity === 'medium') return 'warning';
  return 'note';
}

export function buildSarif(reportValue: unknown) {
  const report = record(reportValue);
  const findings = Array.isArray(report.findings) ? report.findings.map(record).filter(f => f.category !== 'Correlated') : [];
  const ruleIds = [...new Set(findings.map(f => safeText(f.type, 'UnknownFinding')))].sort();
  const ruleIndexes = new Map(ruleIds.map((type, index) => [type, index]));
  const rules = ruleIds.map(type => {
    const sample = findings.find(f => f.type === type);
    return { id: `cloud-sentinel/${type}`, name: type,
      shortDescription: { text: safeText(sample?.title, type) },
      properties: { category: safeText(sample?.category) } };
  });
  const results = findings.filter(f => statusOf(f) !== 'PASS').map(finding => {
    const type = safeText(finding.type, 'UnknownFinding');
    const status = statusOf(finding);
    const title = safeText(finding.title, type);
    const details = safeText(finding.details, safeText(finding.description));
    const message = details ? `${title}: ${details}` : `${title} (${status})`;
    const resource = safeText(finding.resource, 'Unknown resource');
    const severity = safeText(finding.severity);
    return {
      ruleId: `cloud-sentinel/${type}`, ruleIndex: ruleIndexes.get(type),
      level: status === 'FAIL' ? sarifLevel(severity) : 'note',
      kind: status === 'FAIL' ? 'fail' : status === 'SKIPPED' ? 'notApplicable' : 'review',
      message: { text: message },
      locations: [{ logicalLocations: [{ name: resource, kind: 'resource', fullyQualifiedName: resource }] }],
      partialFingerprints: { 'cloud-sentinel/v1': stableFingerprint(finding) },
      properties: { findingId: safeText(finding.id), status, severity, resource,
        service: safeText(finding.category), region: safeText(finding.region), evidence: details,
        remediation: safeText(finding.remediation), cis: scrub(finding.cis || null) },
    };
  });
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json', version: '2.1.0',
    runs: [{ tool: { driver: { name: 'Cloud-Sentinel', version: '0.2.0', rules } }, results,
      properties: { schemaVersion: report.schema_version ?? null, context: scrub(report.context || null),
        coverage: scrub(report.coverage || []), checkSummary: scrub(report.check_summary || null),
        partial: report.partial === true, scoreProvisional: report.score_provisional === true,
        cisSummary: scrub(report.cis_summary || null), assessmentNote: safeText(report.assessment_note),
        requestedAt: report.requested_at || null, completedAt: report.completed_at || null } }],
  };
}
