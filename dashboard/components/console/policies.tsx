'use client';
import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { createPolicy, evaluateStoredPolicy, getPolicies, PolicyEvaluation, PolicyRecord } from '@/lib/api';
import { formatDate, reportScope } from '@/lib/presentation';
import { useAuth } from '@/lib/auth-context';
import { useScopedData } from './overview';
import { useWorkspace } from './workspace';
import { Badge, Button, EmptyState, Field, Loading, Notice, PageHeading, Panel } from './primitives';
import { DemoNotice } from './demo-notice';

const starterPolicy = `apiVersion: cloud-sentinel/v1
kind: Policy
metadata:
  name: public-critical-findings
  version: 1
  description: Find critical failed checks in a saved assessment.
spec:
  resource: finding
  filters:
    - field: status
      op: equals
      value: FAIL
    - field: severity
      op: equals
      value: critical
  severity: high
  remediation: Review the evidence and restrict the affected resource.
`;

export default function Policies() {
  const { token } = useAuth();
  const { refresh } = useWorkspace();
  const { reports, loading: reportsLoading } = useScopedData();
  const [policies, setPolicies] = useState<PolicyRecord[]>([]);
  const [policyLoading, setPolicyLoading] = useState(true);
  const [source, setSource] = useState(starterPolicy);
  const [selectedReport, setSelectedReport] = useState('');
  const [evaluation, setEvaluation] = useState<{ policyId: number; result: PolicyEvaluation } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const activeReport = reports.find(report => String(report.id) === selectedReport) || reports[0];
  const reportId = String(activeReport?.id || '');
  const orderedPolicies = useMemo(() => [...policies].sort((a, b) => a.name.localeCompare(b.name) || b.version - a.version), [policies]);

  useEffect(() => {
    if (!token) return;
    let current = true;
    setPolicyLoading(true);
    getPolicies(token).then(data => { if (current) setPolicies(data.policies); })
      .catch(err => { if (current) setError(err instanceof Error ? err.message : 'Unable to load policies'); })
      .finally(() => { if (current) setPolicyLoading(false); });
    return () => { current = false; };
  }, [token]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const created = await createPolicy(token, source);
      setPolicies(old => [...old, created]);
      setNotice(`Saved ${created.name} version ${created.version}. Policy versions are immutable.`);
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save policy'); }
    finally { setBusy(false); }
  }

  async function evaluate(policy: PolicyRecord) {
    if (!token || !activeReport) return;
    setBusy(true); setError(''); setNotice(''); setEvaluation(null);
    try {
      const result = await evaluateStoredPolicy(token, policy.id, activeReport.id);
      setEvaluation({ policyId: policy.id, result });
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to evaluate policy'); }
    finally { setBusy(false); }
  }

  if (reportsLoading || policyLoading) return <Loading/>;
  return <>
    <PageHeading eyebrow="CUSTOM CONTROLS" title="Policies" description="Versioned, read-only rules evaluated against saved assessment evidence."/>
    {activeReport?.report.demo && <DemoNotice/>}
    <Notice>Policies inspect recorded findings only. They do not query AWS, change resources, or prove that unobserved conditions are safe. Every filter must match.</Notice>
    {error && <Notice tone="error">{error}</Notice>}
    {notice && <Notice tone="info">{notice}</Notice>}
    <Panel title="Write a policy" action={<span className="small muted">cloud-sentinel/v1 · YAML</span>}>
      <form className="panel-body form-stack" onSubmit={save}>
        <Field label="Policy document" hint="Use 1–10 filters. Supported fields: type, category, resource, region, severity, status. Operators: equals, not_equals, contains, in.">
          <textarea aria-label="Policy YAML" spellCheck={false} value={source} onChange={event => setSource(event.target.value)} style={{ width: '100%', minHeight: 310, resize: 'vertical', padding: '13px 15px', border: '1px solid #cad6d9', borderRadius: 4, background: '#f8faf9', color: 'var(--ink)', font: '12px/1.65 var(--mono)' }}/>
        </Field>
        <div className="badge-row"><span className="muted small">Add a new metadata.version to publish a revision.</span><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save policy version'}</Button></div>
      </form>
    </Panel>
    <Panel title="Saved assessments" action={<span className="small muted">{reports.length} in selected account scope</span>}>
      {reports.length ? <div className="panel-body"><Field label="Evaluate against"><select aria-label="Saved assessment" value={reportId} onChange={event => { setSelectedReport(event.target.value); setEvaluation(null); }}>
        {reports.map(report => <option key={report.id} value={report.id}>#{report.id} · {formatDate(report.created_at)} · {reportScope(report)}</option>)}
      </select></Field>{activeReport && <p className="small muted" style={{ marginTop: 10 }}>Evaluation uses saved report #{activeReport.id}; no fresh cloud scan is started.</p>}</div> : <EmptyState title="No saved assessments">Run an assessment before evaluating a policy. Evaluation never starts a scan.</EmptyState>}
    </Panel>
    <Panel title="Policy versions" action={<span className="small muted">{orderedPolicies.length} saved</span>}>
      {!orderedPolicies.length ? <EmptyState title="No policies yet">Save the starter document or write a rule for a resource field you assess.</EmptyState> : <div className="table-scroll"><table aria-label="Saved policy versions"><thead><tr><th>Policy</th><th>Version</th><th>Created</th><th>Evaluation</th></tr></thead><tbody>{orderedPolicies.map(policy => <tr key={policy.id}>
        <td><strong>{policy.name}</strong><small>{policy.description || 'No description'}</small></td><td className="mono">v{policy.version}</td><td>{formatDate(policy.created_at)}</td><td><Button variant="secondary" disabled={busy || !activeReport} onClick={() => void evaluate(policy)}>Evaluate</Button></td>
      </tr>)}</tbody></table></div>}
    </Panel>
    {evaluation && activeReport && <Panel title={`${evaluation.result.policy.name} · v${evaluation.result.policy.version}`} action={<Badge value={evaluation.result.policy.severity}/> }>
      <div className="panel-footnote">Report #{evaluation.result.report_id} · {evaluation.result.matches.length} matching findings{evaluation.result.policy.remediation ? ` · Suggested action: ${evaluation.result.policy.remediation}` : ''}</div>
      {evaluation.result.matches.length ? <div className="table-scroll"><table aria-label="Policy evaluation matches"><thead><tr><th>Finding</th><th>Resource</th><th>Matched evidence</th></tr></thead><tbody>{evaluation.result.matches.map((match, index) => <tr key={match.finding_id || `${match.type}-${match.resource}-${index}`}>
        <td>{match.finding_id ? <Link className="inline-link" href={`/findings?report=${activeReport.id}&finding=${encodeURIComponent(match.finding_id)}`}>{match.type}</Link> : match.type}</td>
        <td className="mono">{match.resource}</td>
        <td>{match.matched_on.map(item => <div key={`${item.field}-${item.op}`}><span className="mono">{item.field} {item.op}</span><small>expected {Array.isArray(item.value) ? item.value.join(', ') : item.value}; observed {item.actual}</small></div>)}</td>
      </tr>)}</tbody></table></div> : <div className="compact-empty">No assessed findings matched. Unavailable or missing fields do not satisfy a policy.</div>}
    </Panel>}
  </>;
}
