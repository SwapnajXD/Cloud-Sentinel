'use client';
import Link from 'next/link';
import { FormEvent, useMemo, useState } from 'react';
import { flattenReports, QueryField, runReportQuery } from '@/lib/query';
import { useScopedData } from './overview';
import { Button, EmptyState, Loading, Notice, PageHeading, Panel } from './primitives';
import { DemoNotice } from './demo-notice';

const examples = [
  { label: 'Failed checks', query: "SELECT finding_id, report_id, scanned_at, account_id, region, severity, type, resource FROM findings WHERE status = 'FAIL' ORDER BY scanned_at DESC LIMIT 100" },
  { label: 'Unknown evidence', query: "SELECT report_id, scanned_at, region, type, resource, title FROM findings WHERE status = 'UNKNOWN' ORDER BY scanned_at DESC LIMIT 100" },
  { label: 'Public exposure checks', query: "SELECT report_id, status, severity, type, resource, title FROM findings WHERE type CONTAINS 'Public' AND status = 'FAIL' ORDER BY severity DESC LIMIT 100" },
];
const starter = examples[0].query;

export default function Query() {
  const { reports, loading } = useScopedData();
  const [source, setSource] = useState(starter);
  const [results, setResults] = useState<ReturnType<typeof runReportQuery> | null>(null);
  const [error, setError] = useState('');
  const rows = useMemo(() => flattenReports(reports), [reports]);
  function execute(event: FormEvent) {
    event.preventDefault(); setError('');
    try { setResults(runReportQuery(rows, source)); }
    catch (err) { setResults(null); setError(err instanceof Error ? err.message : 'Query could not be parsed.'); }
  }
  if (loading) return <Loading/>;
  return <>
    <PageHeading eyebrow="SAVED EVIDENCE" title="Query" description="Ask cross-report questions over saved finding snapshots."/>
    {reports.some(report => report.report.demo) && <DemoNotice/>}
    <Notice>This prototype reads up to 100 saved reports in the selected account scope. Its allowlisted SQL-like grammar runs in your browser; it never executes SQL, starts a scan, or calls AWS.</Notice>
    {reports.length ? <Panel title="Read-only query" action={<span className="small muted">{reports.length} reports · {rows.length} findings</span>}>
      <form className="panel-body form-stack" onSubmit={execute}>
        <label className="field"><span>Query</span><textarea aria-label="Query text" spellCheck={false} value={source} onChange={event => setSource(event.target.value)} style={{ width: '100%', minHeight: 150, resize: 'vertical', padding: '13px 15px', border: '1px solid #cad6d9', borderRadius: 4, background: '#f8faf9', color: 'var(--ink)', font: '12px/1.65 var(--mono)' }}/>
          <small>Fields: {['finding_id', 'report_id', 'scanned_at', 'account_id', 'region', 'status', 'severity', 'type', 'category', 'resource', 'title'].join(', ')}. Filters use AND; operators: =, !=, &lt;, &lt;=, &gt;, &gt;=, CONTAINS.</small>
        </label>
        <div className="badge-row" aria-label="Query examples">{examples.map(example => <Button key={example.label} variant="secondary" onClick={() => { setSource(example.query); setResults(null); setError(''); }}>{example.label}</Button>)}<span className="muted small">LIMIT defaults to 100; maximum 500.</span></div>
        <div className="badge-row"><span className="muted small">Only saved report data is queried.</span><Button type="submit">Run query</Button></div>
      </form>
    </Panel> : <Panel><EmptyState title="No saved reports yet">Run an assessment before querying report snapshots.</EmptyState></Panel>}
    {error && <Notice tone="error">{error}</Notice>}
    {results && <Panel title="Query results" action={<span className="small muted">{results.total} rows</span>}>
      {results.rows.length ? <div className="table-scroll"><table aria-label="Query results"><thead><tr>{results.columns.map(column => <th key={column}>{column.replaceAll('_', ' ')}</th>)}</tr></thead><tbody>{results.rows.map((row, index) => <tr key={`${String(row.finding_id || row.report_id)}-${index}`}>{results.columns.map(column => <td key={column} className={column === 'resource' || column === 'finding_id' ? 'mono' : undefined}>
        {column === 'finding_id' && row.finding_id && row.report_id ? <Link className="inline-link" href={`/findings?report=${row.report_id}&finding=${encodeURIComponent(String(row.finding_id))}`}>{row.finding_id}</Link> : row[column as QueryField] === undefined ? '—' : String(row[column as QueryField])}
      </td>)}</tr>)}</tbody></table></div> : <div className="compact-empty">No findings matched this query. Missing and unknown evidence does not prove the condition is safe.</div>}
    </Panel>}
    <Panel title="Data boundary"><div className="panel-footnote">Rows come from report history already loaded for this workspace, currently capped at 100 reports. Use the report page for complete per-assessment evidence. Query output is read-only and does not alter stored reports.</div></Panel>
  </>;
}
