'use client';

import { FormEvent, useEffect, useMemo, useState, useTransition } from 'react';

type ReportRow = {
  id: number;
  report: Record<string, unknown>;
  created_at: string;
};

type ReportsResponse = {
  reports: ReportRow[];
  count: number;
};

type AuthResponse = {
  token?: string;
  error?: string;
};

type ActionResponse = {
  status?: string;
  message?: string;
  error?: string;
};

type Credentials = {
  email: string;
  password: string;
};

type InsightFinding = {
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'good';
  evidence: string;
  impact: string;
  fix: string;
  resourceArn?: string;
};

type TimelineEntry = {
  id: number;
  createdAt: string;
  riskScore: number;
  delta: number | null;
  summary: string;
};

type ScanSummary = {
  scope: string;
  riskScore: number;
  riskLabel: string;
  unencryptedBuckets: string[];
  runningInstances: string[];
  mfaEnabled: boolean;
  findingsCount: number;
};

const emptyCredentials: Credentials = {
  email: '',
  password: '',
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) as Record<string, unknown>[];
}

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function riskLabel(score: number): ScanSummary['riskLabel'] {
  if (score >= 75) return 'Critical';
  if (score >= 45) return 'Elevated';
  return 'Controlled';
}

function formatScope(report: Record<string, unknown>): string {
  const task = asRecord(report.task);
  const requestedScope = asString(task.params && asRecord(task.params).scope, '');
  return requestedScope || asString(report.action, 'default');
}

function summarizeReport(reportRow: ReportRow): ScanSummary {
  const report = asRecord(reportRow.report);
  const scan = asRecord(report.scan);
  const unencryptedBuckets = asArray(scan.unencrypted_s3_buckets)
    .map((bucket) => asString(bucket.bucket, 'Unnamed bucket'))
    .filter(Boolean);
  const runningInstances = asArray(scan.running_ec2_instances)
    .map((instance) => asString(instance.instance_id, 'Unknown instance'))
    .filter(Boolean);
  const mfa = asRecord(scan.mfa);
  const mfaEnabled = Boolean(mfa.enabled);
  const findingsCount = unencryptedBuckets.length + (mfaEnabled ? 0 : 1) + (runningInstances.length > 0 ? 1 : 0);
  const riskScore = clamp(18 + unencryptedBuckets.length * 20 + runningInstances.length * 6 + (mfaEnabled ? 0 : 24), 0, 100);

  return {
    scope: formatScope(report),
    riskScore,
    riskLabel: riskLabel(riskScore),
    unencryptedBuckets,
    runningInstances,
    mfaEnabled,
    findingsCount,
  };
}

function buildEvidence(summary: ScanSummary | null): InsightFinding[] {
  if (!summary) return [];

  const findings: InsightFinding[] = [];

  if (summary.unencryptedBuckets.length > 0) {
    findings.push({
      title: 'S3 Encryption Gap',
      severity: 'critical',
      evidence: `${summary.unencryptedBuckets.length} bucket(s): ${summary.unencryptedBuckets.join(', ')}`,
      impact: 'Objects can be stored without server-side encryption.',
      fix: 'Enable default encryption, block public ACLs.',
      resourceArn: `arn:aws:s3:::${summary.unencryptedBuckets[0]}/*`,
    });
  }

  if (!summary.mfaEnabled) {
    findings.push({
      title: 'MFA Not Enabled',
      severity: 'high',
      evidence: 'Current identity reports MFA disabled.',
      impact: 'Higher risk of credential abuse leading to account takeover.',
      fix: 'Enable MFA for the active IAM user/role.',
    });
  }

  if (summary.runningInstances.length > 0) {
    findings.push({
      title: 'Active EC2 Surface',
      severity: 'medium',
      evidence: `${summary.runningInstances.length} running instance(s)`,
      impact: 'Expands attack surface and adds cost exposure.',
      fix: 'Terminate idle instances, tag long-lived ones.',
      resourceArn: `arn:aws:ec2:*:${summary.runningInstances[0]}`,
    });
  }

  if (findings.length === 0) {
    findings.push({
      title: 'No Critical Gaps',
      severity: 'good',
      evidence: 'All security checks passed.',
      impact: 'Account posture is healthy for current checks.',
      fix: 'Maintain current security cadence.',
    });
  }

  return findings;
}

function buildTimeline(reports: ReportRow[]): TimelineEntry[] {
  const ordered = reports.slice(0, 5).reverse();
  return ordered.map((report, index) => {
    const summary = summarizeReport(report);
    const previousScore = index > 0 ? summarizeReport(ordered[index - 1]).riskScore : null;
    const delta = previousScore === null ? null : summary.riskScore - previousScore;

    return {
      id: report.id,
      createdAt: report.created_at,
      riskScore: summary.riskScore,
      delta,
      summary: summary.unencryptedBuckets.length > 0
        ? `${summary.unencryptedBuckets.length} bucket(s) need encryption`
        : summary.mfaEnabled ? 'MFA protecting identity' : 'MFA is the main gap',
    };
  });
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('en', { timeStyle: 'medium' }).format(new Date(value));
}

export function DashboardShell(): JSX.Element {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loginForm, setLoginForm] = useState<Credentials>(emptyCredentials);
  const [registerForm, setRegisterForm] = useState<Credentials>(emptyCredentials);
  const [deletePassword, setDeletePassword] = useState('');
  const [auditScope, setAuditScope] = useState('default');
  const [status, setStatus] = useState('Ready to authenticate');
  const [error, setError] = useState('');
  const [loadingReports, startReportsTransition] = useTransition();
  const [loadingAction, startActionTransition] = useTransition();

  const latestReport = reports[0] || null;
  const latestSummary = useMemo(() => (latestReport ? summarizeReport(latestReport) : null), [latestReport]);
  const timeline = useMemo(() => buildTimeline(reports), [reports]);
  const evidence = useMemo(() => buildEvidence(latestSummary), [latestSummary]);

  function clearExpiredSession(message: string) {
    window.localStorage.removeItem('token');
    window.localStorage.removeItem('email');
    setToken(null);
    setEmail('');
    setReports([]);
    setStatus(message);
  }

  useEffect(() => {
    const savedToken = window.localStorage.getItem('token');
    const savedEmail = window.localStorage.getItem('email') || '';
    if (savedToken) {
      setToken(savedToken);
      setEmail(savedEmail);
      fetchReports(savedToken);
    }
  }, []);

  async function fetchReports(activeToken?: string) {
    const authToken = activeToken || token;
    if (!authToken) {
      setReports([]);
      return;
    }

    setError('');
    startReportsTransition(async () => {
      try {
        const response = await fetch('/api/reports', {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        const text = await response.text();
        const payload = (text.trim() ? JSON.parse(text) : {}) as ReportsResponse | ActionResponse;
        if (!response.ok) {
          if (response.status === 401) {
            clearExpiredSession('Session expired');
            return;
          }
          throw new Error('error' in payload ? payload.error : 'Failed to fetch');
        }
        setReports((payload as ReportsResponse).reports);
        setStatus(`Loaded ${(payload as ReportsResponse).count} report(s)`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch');
      }
    });
  }

  async function submitJson(endpoint: string, body: Record<string, unknown>, method = 'POST') {
    if (!token && endpoint !== '/api/register' && endpoint !== '/api/login') {
      throw new Error('Sign in first');
    }

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error('Network error');
    }

    if (response.status === 401) {
      clearExpiredSession('Session expired');
      throw new Error('Session expired');
    }

    const text = await response.text();
    if (!text.trim()) throw new Error('Empty response');
    return JSON.parse(text) as AuthResponse | ActionResponse | ReportsResponse;
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startActionTransition(async () => {
      setError('');
      try {
        const payload = (await submitJson('/api/login', loginForm)) as AuthResponse;
        if (!payload.token) throw new Error(payload.error || 'Login failed');
        setToken(payload.token);
        setEmail(loginForm.email);
        window.localStorage.setItem('token', payload.token);
        window.localStorage.setItem('email', loginForm.email);
        setStatus(`Welcome, ${loginForm.email}`);
        await fetchReports(payload.token);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Login failed');
      }
    });
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startActionTransition(async () => {
      setError('');
      try {
        await submitJson('/api/register', registerForm);
        setStatus('Account created. Sign in to continue.');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Registration failed');
      }
    });
  }

  async function handleQueueAudit() {
    startActionTransition(async () => {
      setError('');
      try {
        const payload = (await submitJson('/api/audit', { params: { scope: auditScope } })) as ActionResponse;
        if (payload.error) throw new Error(payload.error);
        setStatus('Audit queued. Refresh to see results.');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to queue');
      }
    });
  }

  async function handleDeleteAccount() {
    startActionTransition(async () => {
      setError('');
      try {
        if (!deletePassword) throw new Error('Enter password');
        const payload = (await submitJson('/api/account', { password: deletePassword }, 'DELETE')) as ActionResponse;
        if (payload.error) throw new Error(payload.error);
        window.localStorage.removeItem('token');
        window.localStorage.removeItem('email');
        setToken(null);
        setEmail('');
        setReports([]);
        setStatus('Account deleted');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete');
      }
    });
  }

  function handleLogout() {
    window.localStorage.removeItem('token');
    window.localStorage.removeItem('email');
    setToken(null);
    setEmail('');
    setReports([]);
    setLoginForm(emptyCredentials);
    setRegisterForm(emptyCredentials);
    setDeletePassword('');
    setStatus('Signed out');
  }

  return (
    <div className="min-h-screen bg-background text-[#eef2ff] font-sans">
      {/* Status Header */}
      <header className="sticky top-0 z-50 bg-[#0a0a0f]/95 border-b border-slate-800 backdrop-blur">
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2 font-mono text-xs tracking-wider">
            <span className="text-slate-500">CORE</span>
            <span className="text-slate-700">//</span>
            <span className="text-amber-500">AUDIT</span>
            <span className="text-slate-700">/</span>
            <span className="text-cyan-400">AWS-{latestSummary?.scope?.toUpperCase() || 'S3'}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
              </span>
              <span className="font-mono text-[10px] text-slate-400">LIVE-SYNC</span>
            </div>
            <span className={`text-[10px] font-mono ${token ? 'text-emerald-500' : 'text-slate-500'}`}>
              {token ? `AUTH: ${email.split('@')[0].toUpperCase()}` : 'AUTH: NONE'}
            </span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-12 min-h-[calc(100vh-40px)]">
        {/* Sidebar */}
        <aside className="col-span-2 bg-[#0a0a0f] border-r border-slate-800 p-2">
          <div className="mb-3">
            <h1 className="font-mono text-sm font-bold tracking-wider text-amber-500">SENTINEL</h1>
            <p className="text-[10px] text-slate-500 font-mono">v1.0.0 // GUARD</p>
          </div>

          <nav className="space-y-1">
            <div className="text-[10px] font-mono text-slate-600 uppercase tracking-wider mb-2 px-2">Modules</div>
            <div className="bg-slate-800/50 border-l-2 border-amber-500 px-2 py-1 cursor-pointer">
              <span className="text-xs font-mono">DASHBOARD</span>
            </div>
            <div className="px-2 py-1 cursor-pointer hover:bg-slate-800/30">
              <span className="text-xs font-mono text-slate-400">AUDIT-QUEUE</span>
            </div>
            <div className="px-2 py-1 cursor-pointer hover:bg-slate-800/30">
              <span className="text-xs font-mono text-slate-400">REPORTS</span>
            </div>
            <div className="px-2 py-1 cursor-pointer hover:bg-slate-800/30">
              <span className="text-xs font-mono text-slate-400">SETTINGS</span>
            </div>
          </nav>

          {/* Auth Module */}
          <div className="mt-6 pt-4 border-t border-slate-800">
            <div className="text-[10px] font-mono text-slate-600 uppercase tracking-wider mb-2 px-2">Auth</div>
            <div className="space-y-2">
              <form onSubmit={handleLogin} className="space-y-1">
                <input
                  type="email"
                  placeholder="email"
                  value={loginForm.email}
                  onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                  className="w-full bg-background border border-slate-700 rounded px-2 py-1 text-[10px] font-mono text-slate-300 placeholder-slate-600 focus:border-amber-500 outline-none"
                />
                <input
                  type="password"
                  placeholder="pass"
                  value={loginForm.password}
                  onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                  className="w-full bg-background border border-slate-700 rounded px-2 py-1 text-[10px] font-mono text-slate-300 placeholder-slate-600 focus:border-amber-500 outline-none"
                />
                <button type="submit" disabled={loadingAction} className="w-full bg-amber-600/20 border border-amber-600/50 text-amber-500 text-[10px] font-mono py-1 rounded hover:bg-amber-600/30">
                  LOGIN
                </button>
              </form>
            </div>
          </div>
        </aside>

        {/* Main Stage */}
        <main className="col-span-10 p-2 space-y-2">
          {/* Metrics Row - 12 col grid */}
          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-3 bg-[#0a0a0f] border-y border-r border-slate-800 p-2">
              <div className="text-[10px] font-mono text-slate-500 uppercase">Risk Score</div>
              <div className="text-2xl font-mono font-bold tabular-nums text-amber-500">
                {latestSummary?.riskScore ?? '--'}/100
              </div>
              <div className="text-[10px] font-mono text-slate-600">{latestSummary?.riskLabel || 'No scan'}</div>
            </div>
            <div className="col-span-3 bg-[#0a0a0f] border-y border-r border-slate-800 p-2">
              <div className="text-[10px] font-mono text-slate-500 uppercase">Reports</div>
              <div className="text-2xl font-mono font-bold tabular-nums text-cyan-400">
                {String(reports.length).padStart(2, '0')}
              </div>
              <div className="text-[10px] font-mono text-slate-600">Total audits</div>
            </div>
            <div className="col-span-3 bg-[#0a0a0f] border-y border-r border-slate-800 p-2">
              <div className="text-[10px] font-mono text-slate-500 uppercase">Findings</div>
              <div className="text-2xl font-mono font-bold tabular-nums text-red-400">
                {latestSummary?.findingsCount ?? '0'}
              </div>
              <div className="text-[10px] font-mono text-slate-600">Issues detected</div>
            </div>
            <div className="col-span-3 bg-[#0a0a0f] border-y border-r border-slate-800 p-2">
              <div className="text-[10px] font-mono text-slate-500 uppercase">Session</div>
              <div className={`text-lg font-mono font-bold ${token ? 'text-emerald-500' : 'text-slate-600'}`}>
                {token ? 'ACTIVE' : 'LOCKED'}
              </div>
              <div className="text-[10px] font-mono text-slate-600">{token ? email.split('@')[0] : 'Auth required'}</div>
            </div>
          </div>

          {/* Audit Actions */}
          <div className="grid grid-cols-4 gap-2">
            <div className="bg-[#0a0a0f] border-y border-r border-slate-800 p-2">
              <div className="text-[10px] font-mono text-amber-500 uppercase mb-1">Register</div>
              <form onSubmit={handleRegister} className="space-y-1">
                <input
                  type="email"
                  placeholder="email"
                  value={registerForm.email}
                  onChange={(e) => setRegisterForm({ ...registerForm, email: e.target.value })}
                  className="w-full bg-background border border-slate-700 rounded px-2 py-1 text-[10px] font-mono text-slate-300 placeholder-slate-600"
                />
                <input
                  type="password"
                  placeholder="password"
                  value={registerForm.password}
                  onChange={(e) => setRegisterForm({ ...registerForm, password: e.target.value })}
                  className="w-full bg-background border border-slate-700 rounded px-2 py-1 text-[10px] font-mono text-slate-300 placeholder-slate-600"
                />
                <button type="submit" disabled={loadingAction} className="w-full bg-slate-800 text-slate-400 text-[10px] font-mono py-1 rounded hover:bg-slate-700">
                  CREATE
                </button>
              </form>
            </div>
            <div className="bg-[#0a0a0f] border-y border-r border-slate-800 p-2">
              <div className="text-[10px] font-mono text-cyan-400 uppercase mb-1">Queue Audit</div>
              <div className="space-y-1">
                <input
                  type="text"
                  placeholder="scope"
                  value={auditScope}
                  onChange={(e) => setAuditScope(e.target.value)}
                  className="w-full bg-background border border-slate-700 rounded px-2 py-1 text-[10px] font-mono text-slate-300 placeholder-slate-600"
                />
                <button
                  onClick={handleQueueAudit}
                  disabled={!token || loadingAction}
                  className="w-full bg-cyan-600/20 border border-cyan-600/50 text-cyan-400 text-[10px] font-mono py-1 rounded hover:bg-cyan-600/30 disabled:opacity-50"
                >
                  RUN-SCAN
                </button>
              </div>
            </div>
            <div className="bg-[#0a0a0f] border-y border-r border-slate-800 p-2">
              <div className="text-[10px] font-mono text-emerald-500 uppercase mb-1">Actions</div>
              <div className="space-y-1">
                <button
                  onClick={() => fetchReports()}
                  disabled={!token || loadingReports}
                  className="w-full bg-slate-800 text-slate-400 text-[10px] font-mono py-1 rounded hover:bg-slate-700 disabled:opacity-50"
                >
                  REFRESH
                </button>
                <button
                  onClick={handleLogout}
                  disabled={!token}
                  className="w-full bg-slate-800 text-slate-400 text-[10px] font-mono py-1 rounded hover:bg-slate-700 disabled:opacity-50"
                >
                  LOGOUT
                </button>
              </div>
            </div>
            <div className="bg-[#0a0a0f] border-y border-r border-slate-800 p-2 border-l-2 border-l-red-600/50">
              <div className="text-[10px] font-mono text-red-500 uppercase mb-1">Danger Zone</div>
              <div className="space-y-1">
                <input
                  type="password"
                  placeholder="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  className="w-full bg-background border border-slate-700 rounded px-2 py-1 text-[10px] font-mono text-slate-300 placeholder-slate-600"
                />
                <button
                  onClick={handleDeleteAccount}
                  disabled={!token || loadingAction}
                  className="w-full bg-red-600/20 border border-red-600/50 text-red-400 text-[10px] font-mono py-1 rounded hover:bg-red-600/30 disabled:opacity-50"
                >
                  DELETE-ACCT
                </button>
              </div>
            </div>
          </div>

          {/* Findings / Evidence Section */}
          <div>
            <div className="text-[10px] font-mono text-slate-500 uppercase mb-1 px-1">FINDINGS // EVIDENCE-MODE</div>
            <div className="space-y-1">
              {evidence.length === 0 ? (
                <div className="bg-[#0a0a0f] border border-slate-800 border-dashed p-3 text-center">
                  <span className="text-[10px] font-mono text-slate-500">NO FINDINGS // RUN SCAN TO POPULATE</span>
                </div>
              ) : (
                evidence.map((finding, idx) => (
                  <div
                    key={idx}
                    className={`bg-[#0a0a0f] border-y border-r border-slate-800 p-2 ${
                      finding.severity === 'critical' ? 'border-l-2 border-l-red-600' :
                      finding.severity === 'high' ? 'border-l-2 border-l-amber-500' :
                      'border-l-2 border-l-emerald-500'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-mono font-bold">{finding.title}</span>
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                        finding.severity === 'critical' ? 'bg-red-900/50 text-red-400' :
                        finding.severity === 'high' ? 'bg-amber-900/50 text-amber-400' :
                        'bg-emerald-900/50 text-emerald-400'
                      }`}>
                        {finding.severity.toUpperCase()}
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-slate-400">
                      <span className="text-slate-500">EVIDENCE: </span>
                      {finding.resourceArn ? (
                        <code className="font-mono text-[10px] bg-slate-900/50 p-1 text-cyan-400/90">{finding.resourceArn}</code>
                      ) : (
                        <span>{finding.evidence}</span>
                      )}
                    </div>
                    <div className="text-[10px] font-mono text-slate-500 mt-1">
                      <span className="text-slate-600">IMPACT: </span>{finding.impact}
                    </div>
                    <div className="text-[10px] font-mono text-slate-600 mt-1">
                      <span className="text-slate-500">FIX: </span>{finding.fix}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Timeline */}
          <div>
            <div className="text-[10px] font-mono text-slate-500 uppercase mb-1 px-1">TIMELINE // LAST-5-AUDITS</div>
            <div className="grid grid-cols-5 gap-1">
              {timeline.length === 0 ? (
                <div className="col-span-5 bg-[#0a0a0f] border border-slate-800 border-dashed p-3 text-center">
                  <span className="text-[10px] font-mono text-slate-500">NO TIMELINE DATA</span>
                </div>
              ) : (
                timeline.map((entry) => (
                  <div key={entry.id} className="bg-[#0a0a0f] border-y border-r border-slate-800 p-2">
                    <div className="text-[10px] font-mono text-amber-500">#{entry.id}</div>
                    <div className="text-lg font-mono font-bold tabular-nums">{entry.riskScore}</div>
                    <div className="text-[10px] font-mono text-slate-500">{formatTime(entry.createdAt)}</div>
                    <div className={`text-[10px] font-mono ${entry.delta && entry.delta > 0 ? 'text-red-400' : entry.delta === 0 ? 'text-slate-400' : 'text-emerald-400'}`}>
                      {entry.delta === null ? '--' : entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="bg-red-900/20 border border-red-600/50 p-2">
              <span className="text-[10px] font-mono text-red-400">ERROR: {error}</span>
            </div>
          )}

          {/* Status Bar */}
          <div className="bg-[#0a0a0f] border border-slate-800 p-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-slate-500">STATUS:</span>
              <span className="text-[10px] font-mono text-slate-400">{loadingReports || loadingAction ? 'PROCESSING...' : status}</span>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}