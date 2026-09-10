export type CheckStatus = 'PASS' | 'FAIL' | 'SKIPPED' | 'UNKNOWN';
export type Severity = 'critical' | 'medium' | 'low' | 'good' | 'info';
export type Finding = {
  id?: string; type: string; category?: string; resource: string; region?: string;
  status?: CheckStatus; severity: Severity; title?: string; description?: string; details?: unknown;
  impact?: string; remediation?: string; change?: string; is_new?: boolean;
  first_detected?: string | null; last_detected?: string | null;
  cis?: { control_id: string; control_title: string; version: string };
  correlates?: { id?: string; type: string; resource: string }[];
};
export type ScanContext = { account_id: string; connection_id: number | null; region: string; mode: string; services: string[]; schema_version?: number };
export type Diff = {
  has_previous_scan: boolean; new_count: number; resolved_count: number; persisting_count: number;
  changed_count?: number; severity_changed_count?: number; unobserved_count?: number; resolved_findings?: Finding[];
};
export type Report = {
  task_id?: string; schema_version?: number; requested_at?: string; completed_at?: string;
  context?: ScanContext; connection_label?: string; findings: Finding[];
  risk_score?: number | null; risk_grade?: string | null; partial?: boolean; score_provisional?: boolean;
  check_summary?: { pass: number; fail: number; skipped: number; unknown: number };
  coverage?: { service: string; region: string; status: string; checks: number }[];
  cis_summary?: { version: string; controls_assessed: number; controls_passing: number; controls_failing: number; controls_unknown?: number; note?: string };
  diff?: Diff; assessment_note?: string; duration_sec?: number;
};
export type ReportRow = { id: number; report: Report; created_at: string };
export type Task = {
  task_id: string; status: 'queued' | 'running' | 'done' | 'partial' | 'error'; mode: string;
  connection_id: number | null; report_id: number | null; error: string | null;
  created_at: string; updated_at: string; attempts: number; progress: string;
  payload: { region?: string; services?: string[] };
};
export type AwsConnection = { id: number; role_arn: string; label: string | null; region: string; active: boolean; created_at: string };
export type Schedule = {
  id: number; mode: string; interval_hours: number; next_run_at: string; created_at: string;
  connection_id: number | null; region: string; services: string[]; enabled: boolean;
  last_run_at: string | null; last_task_id: string | null; last_status: string | null; last_error: string | null;
};
export type SystemStatus = {
  status: string; checks: Record<string, string>; uptime: number; single_user: boolean;
  region: string; services: string[]; ai_configured: boolean; floci_configured: boolean;
  template_url: string; trusted_principal_arn: string; retry_limit: number; scheduler_poll_seconds: number; version: string;
};
export type ScanInput = { mode: 'aws' | 'floci'; connection_id: number | null; region: string; services: string[] };
export type DeadLetterTask = { task_id: string; mode: string; final_error: string; _retries: number; requested_at: string };
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function apiRequest<T>(endpoint: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(endpoint, { ...options, cache: 'no-store',
    signal: options.signal || AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && token && typeof window !== 'undefined') window.dispatchEvent(new Event('sentinel:session-expired'));
    const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return data as T;
}
export const login = (email: string, password: string) => apiRequest<{ token: string }>('/api/login', { method: 'POST', body: JSON.stringify({ email, password }) });
export const register = (email: string, password: string) => apiRequest<{ id: number; email: string }>('/api/register', { method: 'POST', body: JSON.stringify({ email, password }) });
export const getReports = (token: string) => apiRequest<{ reports: ReportRow[] }>('/api/reports?limit=100', {}, token);
export const getTasks = (token: string) => apiRequest<{ tasks: Task[] }>('/api/tasks?limit=100', {}, token);
export const getSchedules = (token: string) => apiRequest<{ schedules: Schedule[] }>('/api/schedules', {}, token);
export const getAwsConnections = (token: string) => apiRequest<{ connections: AwsConnection[] }>('/api/aws-connections', {}, token);
export const getSystem = (token: string) => apiRequest<SystemStatus>('/api/system', {}, token);
export const queueAudit = (token: string, input: ScanInput) => apiRequest<{ task_id: string }>('/api/audit', { method: 'POST', body: JSON.stringify(input) }, token);
export const getAiSummary = (token: string, reportId: number) => apiRequest<{ summary: string }>('/api/ai/summary', { method: 'POST', body: JSON.stringify({ report_id: reportId }) }, token);
export const deleteAccount = (token: string, password: string) => apiRequest('/api/account', { method: 'DELETE', body: JSON.stringify({ password }) }, token);
export const getDeadLetterTasks = (token: string) => apiRequest<{ tasks: DeadLetterTask[] }>('/api/dead-letter', {}, token);
export const dismissDeadLetterTask = (token: string, taskId: string) => apiRequest(`/api/dead-letter/${encodeURIComponent(taskId)}`, { method: 'DELETE' }, token);
