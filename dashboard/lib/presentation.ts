import { AwsConnection, Finding, ReportRow } from './api';
export const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Not recorded';
export const statusOf = (finding: Finding) => finding.status || 'UNKNOWN';
export const accountName = (id: number | null, connections: AwsConnection[]) => id === null ? 'Worker identity' : connections.find(c => c.id === id)?.label || connections.find(c => c.id === id)?.role_arn.split(':')[4] || `Connection ${id}`;
export const reportScope = (row?: ReportRow) => row?.report.context ? `${row.report.context.account_id} · ${row.report.context.region}` : 'Scope not recorded';
export const shortId = (id?: string) => id ? id.slice(0, 8) : 'Legacy';
export function compatibleReports(reports: ReportRow[], selected?: ReportRow) {
  const context = selected?.report.context;
  if (!context) return [];
  return reports.filter(r => r.report.context && r.report.context.account_id === context.account_id && r.report.context.connection_id === context.connection_id && r.report.context.region === context.region && r.report.context.mode === context.mode && [...r.report.context.services].sort().join() === [...context.services].sort().join());
}
