'use client';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Finding, ReportRow } from '@/lib/api';
import { formatDate, reportScope, statusOf } from '@/lib/presentation';
import { Badge, Button, Dialog, EmptyState, Field, Loading, Notice, PageHeading, Panel } from './primitives';
import { useScopedData } from './overview';
export function FindingDetail({ finding, onClose }: { finding: Finding; onClose: () => void }) {
  const evidence = typeof finding.details === 'string' ? finding.details : finding.description || 'Structured evidence was recorded by an older scanner. Download the report for the original payload.';
  return <Dialog title={finding.title || finding.type} onClose={onClose} wide><div className="dialog-body finding-detail"><div className="badge-row"><Badge value={statusOf(finding)}/><Badge value={finding.severity}/>{finding.change && <Badge value={finding.change}/>}</div>
    <dl className="detail-grid"><div><dt>Resource</dt><dd className="mono break-word">{finding.resource}</dd></div><div><dt>Service / region</dt><dd>{finding.category || 'Not recorded'} / <span className="mono">{finding.region || 'Not recorded'}</span></dd></div><div><dt>First detected</dt><dd>{formatDate(finding.first_detected)}</dd></div><div><dt>Last detected</dt><dd>{formatDate(finding.last_detected)}</dd></div></dl>
    <section><h3>Scanner evidence</h3><p className="evidence">{evidence}</p></section>{finding.impact && <section><h3>Impact</h3><p>{finding.impact}</p></section>}
    <section><h3>Remediation</h3><p>{finding.remediation || (statusOf(finding) === 'PASS' ? 'No remediation is indicated by this check.' : 'Review the resource configuration and the assessment scope.')}</p></section>
    {finding.cis && <section><h3>Related CIS control</h3><p><span className="mono">{finding.cis.control_id}</span> · {finding.cis.control_title}</p><small className="muted">{finding.cis.version} · Selected check evidence, not full benchmark certification.</small></section>}
    {finding.correlates && <section><h3>Related observations</h3><ul className="evidence-list">{finding.correlates.map((c, i) => <li key={c.id || i}><strong>{c.type}</strong><span className="mono">{c.resource}</span></li>)}</ul></section>}
    <div className="dialog-actions"><Button variant="secondary" onClick={onClose}>Close detail</Button></div></div></Dialog>;
}
export function FindingsTable({ findings, initialFinding }: { findings: Finding[]; initialFinding?: string | null }) {
  const [detail, setDetail] = useState<Finding | null>(null);
  useEffect(() => { setDetail(initialFinding ? findings.find(f => f.id === initialFinding) || null : null); }, [initialFinding, findings]);
  return <>{findings.length ? <div className="table-scroll"><table><thead><tr><th>Severity</th><th>Finding / resource</th><th>Service</th><th>Region</th><th>Check status</th><th>Change</th></tr></thead><tbody>{findings.map((f, i) => <tr key={f.id || `${f.type}-${f.resource}-${i}`}><td><Badge value={f.severity}/></td><td className="finding-title-cell"><button className="table-link" onClick={() => setDetail(f)}>{f.title || f.type}</button><small className="mono">{f.resource}</small></td><td>{f.category || '—'}</td><td className="mono">{f.region || 'Not recorded'}</td><td><Badge value={statusOf(f)}/></td><td className="muted">{f.change?.replaceAll('_', ' ') || 'Not compared'}</td></tr>)}</tbody></table></div> : <EmptyState title="No findings match">Try another filter or report. Empty results do not establish complete cloud coverage.</EmptyState>}{detail && <FindingDetail finding={detail} onClose={() => setDetail(null)}/>}</>;
}
export default function Findings() {
  const { reports, loading } = useScopedData(); const params = useSearchParams();
  const [reportId, setReportId] = useState(params.get('report') || 'latest');
  const [query, setQuery] = useState(''); const [severity, setSeverity] = useState('all'); const [service, setService] = useState('all'); const [status, setStatus] = useState('FAIL'); const [region, setRegion] = useState('all'); const [type, setType] = useState('all');
  const selected: ReportRow | undefined = reportId === 'latest' ? reports[0] : reports.find(r => String(r.id) === reportId);
  const all = selected?.report.findings || [];
  const filtered = useMemo(() => all.filter(f => (severity === 'all' || f.severity === severity) && (service === 'all' || f.category === service) && (status === 'all' || statusOf(f) === status) && (region === 'all' || f.region === region) && (type === 'all' || f.type === type) && `${f.title} ${f.resource} ${f.type}`.toLowerCase().includes(query.toLowerCase())), [all, severity, service, status, region, type, query]);
  if (loading) return <Loading/>;
  return <><PageHeading eyebrow="INVESTIGATION" title="Findings" description="Explore evidence, understand exposure, and prioritize remediation."/>
    <div className="filter-toolbar"><Field label="Assessment"><select value={reportId} onChange={e => setReportId(e.target.value)}><option value="latest">Latest assessment</option>{reports.map(r => <option key={r.id} value={r.id}>#{r.id} · {formatDate(r.created_at)} · {reportScope(r)}</option>)}</select></Field><Field label="Search findings"><input type="search" placeholder="Search title, resource or type…" value={query} onChange={e => setQuery(e.target.value)}/></Field></div>
    {selected && <div className="report-context-line"><span className="mono">{reportScope(selected)}</span><span>{formatDate(selected.created_at)}</span><span>{filtered.length} of {all.length} observations</span></div>}
    {selected && !selected.report.context && <Notice tone="warning">Legacy report: check status, region, and observation dates were not recorded. Its findings are displayed as unknown until rescanned.</Notice>}
    <div className="filter-toolbar filter-compact">{[
      ['Severity', severity, setSeverity, ['critical', 'medium', 'low', 'good', 'info']], ['Service', service, setService, [...new Set(all.map(f => f.category).filter((s): s is string => !!s))]],
      ['Check status', status, setStatus, ['FAIL', 'PASS', 'SKIPPED', 'UNKNOWN']], ['Region', region, setRegion, [...new Set(all.map(f => f.region).filter((s): s is string => !!s))]],
      ['Finding type', type, setType, [...new Set(all.map(f => f.type))]],
    ].map(([label, value, setter, options]) => <Field key={String(label)} label={String(label)}><select value={String(value)} onChange={e => (setter as (v: string) => void)(e.target.value)}><option value="all">All</option>{(options as string[]).map(option => <option key={option}>{option}</option>)}</select></Field>)}</div>
    <Panel><FindingsTable findings={filtered} initialFinding={params.get('finding')}/></Panel>
  </>;
}
