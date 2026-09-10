'use client';
import { Finding, ReportRow } from '@/lib/api';
import { formatDate, statusOf } from '@/lib/presentation';
export function SeverityChart({ findings }: { findings: Finding[] }) {
  const failures = findings.filter(f => statusOf(f) === 'FAIL' && f.category !== 'Correlated');
  const total = failures.length;
  return <div className="severity-chart"><div className="severity-track" aria-label={`${total} failed checks by severity`}>{['critical', 'medium', 'low'].map(severity => {
    const count = failures.filter(f => f.severity === severity).length;
    return count ? <span key={severity} className={`severity-${severity}`} style={{ width: `${count / total * 100}%` }} title={`${severity}: ${count}`}/> : null;
  })}</div><div className="severity-legend">{['critical', 'medium', 'low'].map(severity => <div key={severity}><span className={`legend-dot severity-${severity}`}/><span>{severity}</span><strong>{failures.filter(f => f.severity === severity).length}</strong></div>)}</div>{!total && <p className="muted small">No failed checks in this report. Review unknown coverage separately.</p>}</div>;
}
export function TrendChart({ reports }: { reports: ReportRow[] }) {
  const rows = reports.filter(r => typeof r.report.risk_score === 'number').slice(0, 12).reverse();
  if (rows.length < 2) return <div className="chart-empty">A trend appears after two comparable scans.<small>Same account, region, mode, and service scope.</small></div>;
  const points = rows.map((r, i) => `${40 + i * 500 / (rows.length - 1)},${132 - (r.report.risk_score || 0)}`).join(' ');
  return <div className="trend-chart"><svg viewBox="0 0 570 160" role="img" aria-label={`Security scores from oldest to newest: ${rows.map(r => r.report.risk_score).join(', ')}. Higher is better.`}>{[0, 50, 100].map(value => <g key={value}><line x1="40" x2="548" y1={132 - value} y2={132 - value} stroke="#e7ebec"/><text x="8" y={136 - value}>{value}</text></g>)}<polyline points={points} fill="none" stroke="#137e71" strokeWidth="2.5"/>{rows.map((r, i) => <circle key={r.id} cx={40 + i * 500 / (rows.length - 1)} cy={132 - (r.report.risk_score || 0)} r="3.5" fill="#137e71"><title>{formatDate(r.created_at)}: {r.report.risk_score}{r.report.partial ? ' (provisional)' : ''}</title></circle>)}</svg><div className="chart-range"><span>{formatDate(rows[0].created_at)}</span><span>{formatDate(rows.at(-1)?.created_at)}</span></div></div>;
}
