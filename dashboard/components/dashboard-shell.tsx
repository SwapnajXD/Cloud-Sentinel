'use client';

import { FormEvent, useEffect, useMemo, useState, useTransition } from 'react';

type ReportRow = {
  id: number;
  report: Record<string, unknown>;
  created_at: string;
};

type ReportsResponse = { reports: ReportRow[]; count: number };
type AuthResponse = { token?: string; error?: string };
type ActionResponse = { status?: string; message?: string; error?: string };
type Credentials = { email: string; password: string };

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

const emptyCredentials: Credentials = { email: '', password: '' };

function asRecord(v: unknown): Record<string, unknown> {
  return (v && typeof v === 'object' && !Array.isArray(v)) ? v as Record<string, unknown> : {};
}

function asArray(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v)) return [];
  return v.filter(i => i && typeof i === 'object' && !Array.isArray(i)) as Record<string, unknown>[];
}

function asString(v: unknown, f = ''): string {
  if (typeof v === 'string' && v.trim()) return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return f;
}

function clamp(n: number, min: number, max: number) { return Math.min(max, Math.max(min, n)); }

function riskLabel(score: number): string {
  if (score >= 75) return 'CRITICAL';
  if (score >= 45) return 'ELEVATED';
  return 'CONTROLLED';
}

function summarizeReport(reportRow: ReportRow): ScanSummary {
  const report = asRecord(reportRow.report);
  const scan = asRecord(report.scan);
  const buckets = asArray(scan.unencrypted_s3_buckets).map(b => asString(b.bucket, 'Unnamed')).filter(Boolean);
  const instances = asArray(scan.running_ec2_instances).map(i => asString(i.instance_id, 'Unknown')).filter(Boolean);
  const mfa = asRecord(scan.mfa);
  const mfaEnabled = Boolean(mfa.enabled);
  const findingsCount = buckets.length + (mfaEnabled ? 0 : 1) + (instances.length > 0 ? 1 : 0);
  const riskScore = clamp(18 + buckets.length * 20 + instances.length * 6 + (mfaEnabled ? 0 : 24), 0, 100);

  return {
    scope: asString(asRecord(report.task).params && asRecord(asRecord(report.task).params).scope, '') || asString(report.action, 'default'),
    riskScore, riskLabel: riskLabel(riskScore), unencryptedBuckets: buckets, runningInstances: instances, mfaEnabled, findingsCount
  };
}

function buildEvidence(summary: ScanSummary | null): InsightFinding[] {
  if (!summary) return [];
  const findings: InsightFinding[] = [];
  if (summary.unencryptedBuckets.length > 0) {
    findings.push({ title: 'S3 ENCRYPTION GAP', severity: 'critical', evidence: `${summary.unencryptedBuckets.length} bucket(s): ${summary.unencryptedBuckets.join(', ')}`, impact: 'Data stored without server-side encryption.', fix: 'Enable default encryption, block public ACLs.', resourceArn: `arn:aws:s3:::*:${summary.unencryptedBuckets[0]}/*` });
  }
  if (!summary.mfaEnabled) {
    findings.push({ title: 'MFA NOT ENABLED', severity: 'high', evidence: 'Current identity has MFA disabled.', impact: 'Higher credential abuse risk.', fix: 'Enable MFA on IAM user/role.' });
  }
  if (summary.runningInstances.length > 0) {
    findings.push({ title: 'ACTIVE EC2 SURFACE', severity: 'medium', evidence: `${summary.runningInstances.length} running instance(s)`, impact: 'Expands attack surface.', fix: 'Terminate idle instances.' });
  }
  if (findings.length === 0) {
    findings.push({ title: 'NO CRITICAL GAPS', severity: 'good', evidence: 'All security checks passed.', impact: 'Account posture is healthy.', fix: 'Maintain current cadence.' });
  }
  return findings;
}

function buildTimeline(reports: ReportRow[]): TimelineEntry[] {
  const ordered = reports.slice(0, 5).reverse();
  return ordered.map((r, i) => {
    const s = summarizeReport(r);
    const prev = i > 0 ? summarizeReport(ordered[i - 1]).riskScore : null;
    return { id: r.id, createdAt: r.created_at, riskScore: s.riskScore, delta: prev === null ? null : s.riskScore - prev, summary: s.unencryptedBuckets.length > 0 ? `${s.unencryptedBuckets.length} bucket(s) need encryption` : s.mfaEnabled ? 'MFA active' : 'MFA gap' };
  });
}

function formatTime(v: string): string { return new Intl.DateTimeFormat('en', { timeStyle: 'short' }).format(new Date(v)); }

const TERMINAL_LINES = [
  '[INIT] Worker process started',
  '[Redis] Connected to queue: audit-tasks',
  '[PG] Database connection established',
  '[S3] Scanning bucket: audit-logs-prod',
  '[S3] Found 142 objects, checking encryption...',
  '[EC2] Enumerating running instances...',
  '[EC2] Found 3 instances in running state',
  '[IAM] Checking MFA status for current identity',
  '[IAM] MFA status: DISABLED',
  '[SCAN] Generating risk report...',
  '[DONE] Report queued for API delivery'
];

export function DashboardShell(): JSX.Element {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loginForm, setLoginForm] = useState<Credentials>(emptyCredentials);
  const [registerForm, setRegisterForm] = useState<Credentials>(emptyCredentials);
  const [deletePassword, setDeletePassword] = useState('');
  const [auditScope, setAuditScope] = useState('default');
  const [status, setStatus] = useState('READY TO AUTHENTICATE');
  const [error, setError] = useState('');
  const [loadingReports, startReportsTransition] = useTransition();
  const [loadingAction, startActionTransition] = useTransition();

  const latestReport = reports[0] || null;
  const latestSummary = useMemo(() => latestReport ? summarizeReport(latestReport) : null, [latestReport]);
  const timeline = useMemo(() => buildTimeline(reports), [reports]);
  const evidence = useMemo(() => buildEvidence(latestSummary), [latestSummary]);

  function clearExpiredSession(msg: string) {
    window.localStorage.removeItem('token');
    window.localStorage.removeItem('email');
    setToken(null); setEmail(''); setReports([]); setStatus(msg);
  }

  useEffect(() => {
    const t = window.localStorage.getItem('token');
    const e = window.localStorage.getItem('email') || '';
    if (t) { setToken(t); setEmail(e); fetchReports(t); }
  }, []);

  async function fetchReports(activeToken?: string) {
    const authToken = activeToken || token;
    if (!authToken) { setReports([]); return; }
    setError('');
    startReportsTransition(async () => {
      try {
        const res = await fetch('/api/reports', { headers: { Authorization: `Bearer ${authToken}` } });
        const txt = await res.text();
        const payload = (txt.trim() ? JSON.parse(txt) : {}) as ReportsResponse | ActionResponse;
        if (!res.ok) { if (res.status === 401) { clearExpiredSession('SESSION EXPIRED'); return; } throw new Error('error' in payload ? payload.error : 'Failed'); }
        setReports((payload as ReportsResponse).reports);
        setStatus(`LOADED ${(payload as ReportsResponse).count} REPORT(S)`);
      } catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
    });
  }

  async function submitJson(endpoint: string, body: Record<string, unknown>, method = 'POST') {
    if (!token && endpoint !== '/api/register' && endpoint !== '/api/login') throw new Error('Sign in first');
    let response: Response;
    try { response = await fetch(endpoint, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }); }
    catch { throw new Error('Network error'); }
    if (response.status === 401) { clearExpiredSession('SESSION EXPIRED'); throw new Error('Session expired'); }
    const txt = await response.text();
    if (!txt.trim()) throw new Error('Empty response');
    return JSON.parse(txt) as AuthResponse | ActionResponse | ReportsResponse;
  }

  async function handleLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startActionTransition(async () => {
      setError('');
      try {
        const payload = (await submitJson('/api/login', loginForm)) as AuthResponse;
        if (!payload.token) throw new Error(payload.error || 'Login failed');
        setToken(payload.token); setEmail(loginForm.email);
        window.localStorage.setItem('token', payload.token); window.localStorage.setItem('email', loginForm.email);
        setStatus(`WELCOME, ${loginForm.email}`);
        await fetchReports(payload.token);
      } catch (err) { setError(err instanceof Error ? err.message : 'Login failed'); }
    });
  }

  async function handleRegister(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startActionTransition(async () => { setError(''); try { await submitJson('/api/register', registerForm); setStatus('ACCOUNT CREATED. SIGN IN.'); } catch (err) { setError(err instanceof Error ? err.message : 'Failed'); } });
  }

  async function handleQueueAudit() {
    startActionTransition(async () => { setError(''); try { const p = (await submitJson('/api/audit', { params: { scope: auditScope } })) as ActionResponse; if (p.error) throw new Error(p.error); setStatus('AUDIT QUEUED.'); } catch (err) { setError(err instanceof Error ? err.message : 'Failed'); } });
  }

  async function handleDeleteAccount() {
    startActionTransition(async () => { setError(''); try { if (!deletePassword) throw new Error('Enter password'); const p = (await submitJson('/api/account', { password: deletePassword }, 'DELETE')) as ActionResponse; if (p.error) throw new Error(p.error); window.localStorage.removeItem('token'); window.localStorage.removeItem('email'); setToken(null); setEmail(''); setReports([]); setStatus('ACCOUNT DELETED'); } catch (err) { setError(err instanceof Error ? err.message : 'Failed'); } });
  }

  function handleLogout() {
    window.localStorage.removeItem('token'); window.localStorage.removeItem('email');
    setToken(null); setEmail(''); setReports([]); setLoginForm(emptyCredentials); setRegisterForm(emptyCredentials); setDeletePassword(''); setStatus('SIGNED OUT');
  }

  // SOC-GRADE INTERFACE
  return (
    <div className="min-h-screen bg-[#050505] text-slate-200 font-sans selection:bg-cyan-500/30">
      {/* HEADER - Top Bar */}
      <header className="h-8 bg-[#0a0a0f] border-b border-slate-800 flex items-center justify-between px-3">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold tracking-wider text-cyan-500 font-mono">◆ SENTINEL</span>
          <span className="text-slate-700 text-[10px]">│</span>
          <span className="text-[10px] font-mono text-slate-500">CORE</span>
          <span className="text-slate-700 text-[10px]">//</span>
          <span className="text-[10px] font-mono text-amber-500">AUDIT</span>
          <span className="text-slate-700 text-[10px]">/</span>
          <span className="text-[10px] font-mono text-cyan-400">{latestSummary?.scope?.toUpperCase() || 'DEFAULT'}</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyan-500"></span></span>
            <span className="text-[10px] font-mono text-cyan-500 tracking-wider">LIVE</span>
          </div>
          <span className="text-[10px] font-mono text-slate-600">│</span>
          <span className={`text-[10px] font-mono ${token ? 'text-emerald-500' : 'text-slate-600'}`}>{token ? `AUTH: ${email.split('@')[0].toUpperCase()}` : 'AUTH: NONE'}</span>
        </div>
      </header>

      {/* MAIN GRID - 12 Column */}
      <div className="grid grid-cols-12 min-h-[calc(100vh-32px)]">
        {/* LEFT SIDEBAR - Module Nav */}
        <aside className="col-span-2 bg-[#080808] border-r border-slate-800 p-2 flex flex-col">
          <div className="pb-2 border-b border-slate-800 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">MODULES</span>
          </div>
          <nav className="space-y-0 flex-1">
            {['DASHBOARD', 'AUDIT QUEUE', 'REPORTS', 'SETTINGS'].map((m, i) => (
              <div key={m} className={`px-2 py-1.5 cursor-pointer border-l-2 ${i === 0 ? 'bg-slate-800/50 border-cyan-500' : 'border-transparent hover:bg-slate-800/30'}`}>
                <span className={`text-[10px] font-mono tracking-tight ${i === 0 ? 'text-cyan-400' : 'text-slate-500'}`}>{m}</span>
              </div>
            ))}
          </nav>
          {/* Auth in Sidebar */}
          <div className="pt-2 border-t border-slate-800 mt-auto">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">AUTH</div>
            <form onSubmit={handleLogin} className="space-y-1">
              <input type="email" placeholder="email" value={loginForm.email} onChange={e => setLoginForm({ ...loginForm, email: e.target.value })} className="w-full bg-[#050505] border border-slate-800 px-2 py-1 text-[10px] font-mono text-slate-300 placeholder-slate-700 focus:border-cyan-500 outline-none" />
              <input type="password" placeholder="pass" value={loginForm.password} onChange={e => setLoginForm({ ...loginForm, password: e.target.value })} className="w-full bg-[#050505] border border-slate-800 px-2 py-1 text-[10px] font-mono text-slate-300 placeholder-slate-700 focus:border-cyan-500 outline-none" />
              <button type="submit" disabled={loadingAction} className="w-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-[10px] font-mono py-1 hover:bg-cyan-500/20 disabled:opacity-50">LOGIN</button>
            </form>
          </div>
        </aside>

        {/* MAIN CONTENT */}
        <main className="col-span-10 p-3 space-y-3">
          {/* METRICS GRID - 4 columns */}
          <div className="grid grid-cols-4 gap-px bg-slate-800">
            {[
              { label: 'RISK SCORE', value: latestSummary?.riskScore ?? '--', unit: '/100', color: latestSummary?.riskScore >= 75 ? 'text-red-500' : latestSummary?.riskScore >= 45 ? 'text-amber-500' : 'text-cyan-500', sub: latestSummary?.riskLabel || 'NO SCAN' },
              { label: 'REPORTS', value: String(reports.length).padStart(2, '0'), unit: '', color: 'text-cyan-400', sub: 'TOTAL AUDITS' },
              { label: 'FINDINGS', value: latestSummary?.findingsCount ?? '0', unit: '', color: 'text-red-400', sub: 'ISSUES' },
              { label: 'SESSION', value: token ? 'ACTIVE' : 'LOCKED', unit: '', color: token ? 'text-emerald-500' : 'text-slate-600', sub: token ? email.split('@')[0].toUpperCase() : 'AUTH REQ' }
            ].map((m, i) => (
              <div key={i} className="bg-[#0a0a0f] p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{m.label}</span>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className={`text-2xl font-mono font-bold tracking-tighter ${m.color}`}>{m.value}</span>
                  <span className="text-[10px] font-mono text-slate-600">{m.unit}</span>
                </div>
                <span className="text-[10px] font-mono text-slate-600">{m.sub}</span>
              </div>
            ))}
          </div>

          {/* ACTIONS GRID - 4 columns */}
          <div className="grid grid-cols-4 gap-px bg-slate-800">
            <div className="bg-[#0a0a0f] p-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-500 mb-2 block">REGISTER</span>
              <form onSubmit={handleRegister} className="space-y-1">
                <input type="email" placeholder="email" value={registerForm.email} onChange={e => setRegisterForm({ ...registerForm, email: e.target.value })} className="w-full bg-[#050505] border border-slate-800 px-2 py-1 text-[10px] font-mono text-slate-300 placeholder-slate-700" />
                <input type="password" placeholder="pass" value={registerForm.password} onChange={e => setRegisterForm({ ...registerForm, password: e.target.value })} className="w-full bg-[#050505] border border-slate-800 px-2 py-1 text-[10px] font-mono text-slate-300 placeholder-slate-700" />
                <button type="submit" disabled={loadingAction} className="w-full bg-slate-800 text-slate-400 text-[10px] font-mono py-1 hover:bg-slate-700">CREATE</button>
              </form>
            </div>
            <div className="bg-[#0a0a0f] p-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-500 mb-2 block">QUEUE AUDIT</span>
              <div className="space-y-1">
                <input type="text" placeholder="scope" value={auditScope} onChange={e => setAuditScope(e.target.value)} className="w-full bg-[#050505] border border-slate-800 px-2 py-1 text-[10px] font-mono text-slate-300 placeholder-slate-700" />
                <button onClick={handleQueueAudit} disabled={!token || loadingAction} className="w-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-[10px] font-mono py-1 hover:bg-cyan-500/20 disabled:opacity-50">RUN-SCAN</button>
              </div>
            </div>
            <div className="bg-[#0a0a0f] p-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-500 mb-2 block">ACTIONS</span>
              <div className="space-y-1">
                <button onClick={() => fetchReports()} disabled={!token || loadingReports} className="w-full bg-slate-800 text-slate-400 text-[10px] font-mono py-1 hover:bg-slate-700 disabled:opacity-50">REFRESH</button>
                <button onClick={handleLogout} disabled={!token} className="w-full bg-slate-800 text-slate-400 text-[10px] font-mono py-1 hover:bg-slate-700 disabled:opacity-50">LOGOUT</button>
              </div>
            </div>
            <div className="bg-[#0a0a0f] p-3 border-l border-red-500/30">
              <span className="text-[10px] font-bold uppercase tracking-wider text-red-500 mb-2 block">DANGER ZONE</span>
              <div className="space-y-1">
                <input type="password" placeholder="pass" value={deletePassword} onChange={e => setDeletePassword(e.target.value)} className="w-full bg-[#050505] border border-slate-800 px-2 py-1 text-[10px] font-mono text-slate-300 placeholder-slate-700" />
                <button onClick={handleDeleteAccount} disabled={!token || loadingAction} className="w-full bg-red-500/10 border border-red-500/30 text-red-400 text-[10px] font-mono py-1 hover:bg-red-500/20 disabled:opacity-50">DELETE</button>
              </div>
            </div>
          </div>

          {/* FINDINGS - List View with divide-y */}
          <div className="bg-[#0a0a0f] border border-slate-800">
            <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">FINDINGS // EVIDENCE MODE</span>
              <span className="text-[10px] font-mono text-slate-600">{evidence.length} TOTAL</span>
            </div>
            <div className="divide-y divide-slate-800">
              {evidence.length === 0 ? (
                <div className="px-3 py-4 text-center"><span className="text-[10px] font-mono text-slate-600">NO FINDINGS // RUN SCAN</span></div>
              ) : (
                evidence.map((f, i) => (
                  <div key={i} className={`px-3 py-2 border-l-2 ${f.severity === 'critical' ? 'border-l-red-500' : f.severity === 'high' ? 'border-l-amber-500' : 'border-l-emerald-500'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-mono font-bold text-slate-200">{f.title}</span>
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 font-mono ${f.severity === 'critical' ? 'bg-red-500/20 text-red-500 border border-red-500/30' : f.severity === 'high' ? 'bg-amber-500/20 text-amber-500 border border-amber-500/30' : 'bg-emerald-500/20 text-emerald-500 border border-emerald-500/30'}`}>{f.severity}</span>
                    </div>
                    <div className="text-[10px] font-mono text-slate-400 mb-1">
                      <span className="text-slate-600">EVIDENCE:</span> {f.resourceArn ? <code className="text-cyan-400 bg-slate-800 px-1">{f.resourceArn}</code> : f.evidence}
                    </div>
                    <div className="text-[10px] font-mono text-slate-500"><span className="text-slate-600">IMPACT:</span> {f.impact}</div>
                    <div className="text-[10px] font-mono text-slate-600 mt-1"><span className="text-slate-500">FIX:</span> {f.fix}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* TIMELINE - 5 column grid */}
          <div className="bg-[#0a0a0f] border border-slate-800">
            <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">TIMELINE // LAST 5 AUDITS</span>
            </div>
            <div className="grid grid-cols-5 divide-x divide-slate-800">
              {timeline.length === 0 ? (
                <div className="col-span-5 px-3 py-4 text-center"><span className="text-[10px] font-mono text-slate-600">NO TIMELINE DATA</span></div>
              ) : (
                timeline.map(t => (
                  <div key={t.id} className="p-3 text-center">
                    <span className="text-[10px] font-mono text-amber-500">#{t.id}</span>
                    <div className={`text-xl font-mono font-bold mt-1 ${t.riskScore >= 75 ? 'text-red-500' : t.riskScore >= 45 ? 'text-amber-500' : 'text-cyan-500'}`}>{t.riskScore}</div>
                    <span className="text-[9px] font-mono text-slate-600 block mt-1">{formatTime(t.createdAt)}</span>
                    <span className={`text-[9px] font-mono mt-1 block ${t.delta && t.delta > 0 ? 'text-red-500' : t.delta === 0 ? 'text-slate-500' : 'text-emerald-500'}`}>{t.delta === null ? '--' : t.delta > 0 ? `+${t.delta}` : String(t.delta)}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* TERMINAL FEED - Real-time log output */}
          <div className="bg-[#050505] border border-slate-800">
            <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-500">TERMINAL FEED // LIVE</span>
              <div className="flex items-center gap-2">
                <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyan-500"></span></div>
                <span className="text-[9px] font-mono text-slate-600">STREAMING</span>
              </div>
            </div>
            <div className="h-32 overflow-y-auto p-2 font-mono text-[10px] space-y-0.5">
              {TERMINAL_LINES.map((line, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-slate-600 shrink-0">{formatTime(new Date().toISOString())}</span>
                  <span className={line.includes('[DONE]') ? 'text-emerald-500' : line.includes('[ERROR]') ? 'text-red-500' : line.includes('[WARN]') ? 'text-amber-500' : 'text-slate-400'}>{line}</span>
                </div>
              ))}
              <div className="flex gap-2 animate-pulse">
                <span className="text-slate-600 shrink-0">{formatTime(new Date().toISOString())}</span>
                <span className="text-cyan-500">_</span>
              </div>
            </div>
          </div>

          {/* SCAN PROGRESS BAR - 2px thin */}
          <div className="bg-[#0a0a0f] border border-slate-800 p-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">SCAN PROGRESS</span>
              <span className="text-[10px] font-mono text-slate-600">IDLE</span>
            </div>
            <div className="h-0.5 bg-slate-800 w-full">
              <div className="h-full bg-cyan-500 w-0 transition-all duration-500"></div>
            </div>
          </div>

          {/* ERROR */}
          {error && <div className="bg-red-500/10 border border-red-500/30 px-3 py-2"><span className="text-[10px] font-mono text-red-500">ERROR: {error}</span></div>}

          {/* STATUS BAR */}
          <div className="bg-[#0a0a0f] border border-slate-800 px-3 py-2 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">STATUS</span>
            <span className="text-[10px] font-mono text-slate-400">{loadingReports || loadingAction ? 'PROCESSING...' : status}</span>
          </div>
        </main>
      </div>
    </div>
  );
}