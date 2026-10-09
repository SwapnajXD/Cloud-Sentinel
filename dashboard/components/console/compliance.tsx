'use client';
import Link from 'next/link';
import type { Finding } from '@/lib/api';
import { formatDate, reportScope, statusOf } from '@/lib/presentation';
import { Badge, EmptyState, Loading, PageHeading, Panel } from './primitives';
import { useScopedData } from './overview';

export function buildControlRows(findings: Finding[]) {
  const controls = new Map<string, { control_id: string; control_title: string; findings: Finding[] }>();
  for (const finding of findings) {
    if (!finding.cis) continue;
    const { control_id, control_title } = finding.cis;
    const row = controls.get(control_id);
    if (row) row.findings.push(finding);
    else controls.set(control_id, { control_id, control_title, findings: [finding] });
  }
  return [...controls.values()]
    .sort((a, b) => a.control_id.localeCompare(b.control_id, 'en', { numeric: true }))
    .map(row => ({ ...row, status: row.findings.some(f => statusOf(f) === 'FAIL') ? 'FAIL'
      : row.findings.every(f => statusOf(f) === 'PASS') ? 'PASS' : 'UNKNOWN' }));
}

export default function Compliance() {
  const { reports, loading } = useScopedData();
  if (loading) return <Loading/>;
  const latest = reports[0];
  const summary = latest?.report.cis_summary;
  const controls = buildControlRows(latest?.report.findings || []);
  const percentage = summary && summary.controls_assessed > 0
    ? Math.round(summary.controls_passing / summary.controls_assessed * 100) : null;

  return <>
    <PageHeading eyebrow="CIS AWS FOUNDATIONS" title="Compliance"
      description={latest ? `${reportScope(latest)} · ${formatDate(latest.created_at)}` : 'Review CIS control evidence from your latest assessment.'}/>
    {!latest ? <Panel><EmptyState title="No assessments yet">Run an assessment to see CIS control evidence for this account context.</EmptyState></Panel> : <>
      <Panel title="CIS control coverage">
        <div className="posture">
          <div className="score-block"><span className="score-number">{percentage ?? '—'}</span><span className="score-denominator">%</span>
            <div className="score-caption">{summary ? `${summary.controls_passing} of ${summary.controls_assessed} assessed controls passing` : 'Coverage not recorded'}</div>
          </div>
          <div className="posture-context"><strong>CIS AWS Foundations Benchmark</strong><span>{summary?.version || 'Version not recorded'}</span><span>Selected check evidence, not full benchmark certification.</span>{summary?.note && <span>{summary.note}</span>}</div>
        </div>
        <div className="panel-footnote">Only findings with a real CIS mapping are shown here. RDS/Lambda findings are intentionally excluded since those services are not part of this benchmark. Unknown or skipped evidence is never a pass.</div>
      </Panel>
      <Panel title="Controls">
        {controls.length ? <div className="table-scroll"><table aria-label="CIS controls"><thead><tr><th scope="col">Control</th><th scope="col">Status</th><th scope="col">Resources / findings</th></tr></thead>
          <tbody>{controls.map(control => <tr key={control.control_id}>
            <td><span className="mono">{control.control_id}</span><small>{control.control_title}</small></td>
            <td><Badge value={control.status}/></td>
            <td>{control.findings.map((finding, index) => <div key={finding.id || index}>
              <Link className="inline-link" href={`/findings?report=${latest.id}&finding=${encodeURIComponent(finding.id || '')}`}>{finding.title || finding.type}</Link>
              <small className="mono break-word">{finding.resource}</small>
            </div>)}</td>
          </tr>)}</tbody></table></div> : <div className="compact-empty">No CIS-mapped findings in this assessment. Empty results do not establish benchmark compliance.</div>}
      </Panel>
    </>}
  </>;
}
