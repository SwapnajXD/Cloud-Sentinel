import { Finding, ReportRow } from './api';

const secretKey = /password|secret|token|credential|external.?id|access.?key|user.?id/i;
function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !secretKey.test(key)).map(([key, child]) => [key, sanitize(child)]));
  return value;
}
function escapeHtml(value: unknown): string {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
function evidence(finding: Finding): string {
  if (typeof finding.details === 'string') return finding.details;
  if (finding.description) return finding.description;
  return 'No textual evidence was recorded.';
}

export function buildPortableJson(row: ReportRow) {
  return sanitize({ id: row.id, created_at: row.created_at, report: row.report }) as Record<string, unknown>;
}

export function buildOfflineHtml(row: ReportRow): string {
  const safeRow = buildPortableJson(row);
  const report = safeRow.report as Record<string, unknown>;
  const findings = Array.isArray(report.findings) ? report.findings as Finding[] : [];
  const context = report.context as { account_id?: string; region?: string; mode?: string; services?: string[] } | undefined;
  const requestedAt = typeof report.requested_at === 'string' ? report.requested_at : '';
  const completedAt = typeof report.completed_at === 'string' ? report.completed_at : '';
  const checks = report.check_summary as { pass?: number; fail?: number; unknown?: number; skipped?: number } | undefined;
  const cis = report.cis_summary as { version?: string; controls_assessed?: number; controls_passing?: number; controls_failing?: number; controls_unknown?: number; note?: string } | undefined;
  const coverage = Array.isArray(report.coverage) ? report.coverage as { service?: string; region?: string; status?: string; checks?: number }[] : [];
  const rows = findings.map(finding => `<tr><td>${escapeHtml(finding.status || 'UNKNOWN')}</td><td>${escapeHtml(finding.severity || 'info')}</td><td>${escapeHtml(finding.title || finding.type)}</td><td><code>${escapeHtml(finding.resource)}</code></td><td>${escapeHtml(evidence(finding))}</td><td>${escapeHtml(finding.remediation || '')}</td></tr>`).join('\n');
  const scope = [context?.account_id, context?.region, context?.mode].filter(Boolean).join(' · ') || 'Scope not recorded';
  const coverageRows = coverage.map(item => `<li><strong>${escapeHtml(item.service)}</strong> · ${escapeHtml(item.region)} · ${escapeHtml(item.status)} · ${escapeHtml(item.checks)} checks</li>`).join('');
  const score = typeof report.risk_score === 'number' ? `${report.risk_score}/100${report.risk_grade ? ` · Grade ${escapeHtml(report.risk_grade)}` : ''}` : 'Not assessed';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cloud-Sentinel report #${escapeHtml(safeRow.id)}</title>
<style>body{margin:0;background:#f4f7f6;color:#172a31;font:14px/1.55 system-ui,sans-serif}main{max-width:1180px;margin:0 auto;padding:36px 24px}header,.card{background:#fff;border:1px solid #dce5e4;border-radius:6px;padding:22px;margin-bottom:18px}h1{font-size:24px;margin:0 0 6px}h2{font-size:15px;margin:0 0 14px}p,.muted{color:#5f7076}code{font-family:ui-monospace,monospace;overflow-wrap:anywhere}.metrics{display:flex;gap:22px;flex-wrap:wrap}.metrics strong{font-size:19px}ul{padding-left:20px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;vertical-align:top;padding:10px;border-bottom:1px solid #e6eceb}th{background:#f5f8f7}td{overflow-wrap:anywhere}.scroll{overflow-x:auto}.warning{color:#985b14}.critical{color:#a8323d}@media print{body{background:#fff}main{padding:0}.card,header{break-inside:avoid;border-color:#ddd}}</style></head>
<body><main><header><p class="muted">CLOUD-SENTINEL · OFFLINE ASSESSMENT</p><h1>Report #${escapeHtml(safeRow.id)}</h1>${report.demo === true ? '<p class="warning"><strong>DEMO DATA · Fictional resources · No AWS account was scanned</strong></p>' : ''}<p>${escapeHtml(scope)} · Saved ${escapeHtml(safeRow.created_at)}${requestedAt ? ` · Started ${escapeHtml(requestedAt)}` : ''}${completedAt ? ` · Completed ${escapeHtml(completedAt)}` : ''}</p><p>${escapeHtml(report.assessment_note || 'Selected configuration checks only.')}</p></header>
<section class="card"><h2>Assessment summary</h2><div class="metrics"><div><strong>${escapeHtml(score)}</strong><br><span class="muted">Observed score</span></div><div><strong>${escapeHtml(checks?.pass ?? '—')}</strong><br><span class="muted">Pass</span></div><div><strong class="critical">${escapeHtml(checks?.fail ?? '—')}</strong><br><span class="muted">Fail</span></div><div><strong class="warning">${escapeHtml(checks?.unknown ?? '—')}</strong><br><span class="muted">Unknown</span></div><div><strong>${escapeHtml(checks?.skipped ?? '—')}</strong><br><span class="muted">Skipped</span></div></div><p class="muted">Coverage: ${escapeHtml(context?.services?.join(', ') || 'not recorded')}. ${report.partial ? 'This assessment is partial.' : ''} ${report.score_provisional ? 'The score is provisional.' : ''}</p>${cis ? `<p>CIS ${escapeHtml(cis.version || 'version not recorded')}: ${escapeHtml(cis.controls_passing ?? 0)} passing / ${escapeHtml(cis.controls_assessed ?? 0)} assessed, ${escapeHtml(cis.controls_failing ?? 0)} failing, ${escapeHtml(cis.controls_unknown ?? 0)} unknown. ${escapeHtml(cis.note || 'Selected check evidence only; not full benchmark certification.')}</p>` : ''}</section>
<section class="card"><h2>Service coverage</h2>${coverageRows ? `<ul>${coverageRows}</ul>` : '<p class="muted">Coverage details were not recorded.</p>'}</section>
<section class="card"><h2>Findings and evidence (${findings.length})</h2><div class="scroll"><table><thead><tr><th>Status</th><th>Severity</th><th>Finding</th><th>Resource</th><th>Evidence</th><th>Remediation</th></tr></thead><tbody>${rows}</tbody></table></div></section>
<footer class="muted">Generated by Cloud-Sentinel. This report reflects recorded checks and does not establish complete cloud coverage or end-to-end reachability.</footer></main></body></html>`;
}
