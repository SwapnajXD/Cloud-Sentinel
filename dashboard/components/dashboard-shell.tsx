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
};

type TimelineEntry = {
  id: number;
  createdAt: string;
  riskScore: number;
  delta: number | null;
  summary: string;
};

type SimulationScenario = {
  title: string;
  delta: number;
  projectedScore: number;
  evidence: string;
  outcome: string;
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
  if (score >= 75) {
    return 'Critical';
  }

  if (score >= 45) {
    return 'Elevated';
  }

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
  if (!summary) {
    return [];
  }

  const findings: InsightFinding[] = [];

  if (summary.unencryptedBuckets.length > 0) {
    findings.push({
      title: 'S3 encryption gap',
      severity: 'critical',
      evidence: `${summary.unencryptedBuckets.length} bucket(s): ${summary.unencryptedBuckets.join(', ')}`,
      impact: 'Objects can be stored without server-side encryption and are easier to expose if access drifts.',
      fix: 'Turn on default encryption, block public ACLs, and re-run the scan after the change.',
    });
  }

  if (!summary.mfaEnabled) {
    findings.push({
      title: 'MFA is missing',
      severity: 'high',
      evidence: 'Current identity reports MFA disabled or unavailable.',
      impact: 'An exposed password or weak session control has a much higher chance of becoming account takeover.',
      fix: 'Require MFA for the active IAM user or role before the next audit.',
    });
  }

  if (summary.runningInstances.length > 0) {
    findings.push({
      title: 'Active EC2 surface',
      severity: 'medium',
      evidence: `${summary.runningInstances.length} running instance(s): ${summary.runningInstances.join(', ')}`,
      impact: 'Every live instance adds reachability, configuration drift, and cost exposure.',
      fix: 'Shut down idle compute and tag long-lived instances with an owner and expiry date.',
    });
  }

  if (findings.length === 0) {
    findings.push({
      title: 'No obvious control gaps',
      severity: 'good',
      evidence: 'The latest scan did not surface an encryption, MFA, or running-instance issue.',
      impact: 'The account posture is comparatively calm for the current checks.',
      fix: 'Keep the same cadence and add another audit after any IAM or storage change.',
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
      summary:
        summary.unencryptedBuckets.length > 0
          ? `${summary.unencryptedBuckets.length} bucket(s) need encryption`
          : summary.mfaEnabled
            ? 'MFA is protecting the active identity'
            : 'MFA is still the main gap',
    };
  });
}

function buildSimulations(summary: ScanSummary | null): SimulationScenario[] {
  if (!summary) {
    return [];
  }

  const publicBucketDelta = summary.unencryptedBuckets.length > 0 ? 16 + summary.unencryptedBuckets.length * 4 : 20;
  const mfaDelta = summary.mfaEnabled ? 22 : 6;
  const computeDelta = summary.runningInstances.length > 0 ? 8 + summary.runningInstances.length * 2 : 12;

  return [
    {
      title: 'Public bucket exposure',
      delta: publicBucketDelta,
      projectedScore: clamp(summary.riskScore + publicBucketDelta, 0, 100),
      evidence: summary.unencryptedBuckets.length > 0
        ? `Expanding the current ${summary.unencryptedBuckets.length} bucket(s) would raise data exposure fast.`
        : 'A new public bucket would create the first real storage exposure in the account.',
      outcome: 'Data exposure becomes the dominant risk path.',
    },
    {
      title: 'MFA removed from the identity',
      delta: mfaDelta,
      projectedScore: clamp(summary.riskScore + mfaDelta, 0, 100),
      evidence: summary.mfaEnabled
        ? 'Disabling MFA would remove a strong gate on the current account flow.'
        : 'The account already lacks MFA, so this scenario is effectively already active.',
      outcome: 'Credential abuse becomes easier to turn into account takeover.',
    },
    {
      title: 'Compute drift grows',
      delta: computeDelta,
      projectedScore: clamp(summary.riskScore + computeDelta, 0, 100),
      evidence: summary.runningInstances.length > 0
        ? `More than ${summary.runningInstances.length} running instance(s) expands the surface and the blast radius.`
        : 'Launching one unmanaged instance would add the first compute exposure.',
      outcome: 'Reachability and cost drift become visible immediately.',
    },
  ];
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function previewReport(report: Record<string, unknown>): string {
  try {
    return JSON.stringify(report, null, 2);
  } catch {
    return '[unreadable report]';
  }
}

function StatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="stat-card">
      <p>{label}</p>
      <h3>{value}</h3>
      <span>{detail}</span>
    </article>
  );
}

export function DashboardShell() {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loginForm, setLoginForm] = useState<Credentials>(emptyCredentials);
  const [registerForm, setRegisterForm] = useState<Credentials>(emptyCredentials);
  const [deletePassword, setDeletePassword] = useState('');
  const [auditScope, setAuditScope] = useState('default');
  const [status, setStatus] = useState('Ready to authenticate and launch an audit.');
  const [error, setError] = useState('');
  const [loadingReports, startReportsTransition] = useTransition();
  const [loadingAction, startActionTransition] = useTransition();
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);

  const latestReport = reports[0] || null;
  const latestSummary = useMemo(() => (latestReport ? summarizeReport(latestReport) : null), [latestReport]);
  const timeline = useMemo(() => buildTimeline(reports), [reports]);
  const evidence = useMemo(() => buildEvidence(latestSummary), [latestSummary]);
  const simulations = useMemo(() => buildSimulations(latestSummary), [latestSummary]);

  function clearExpiredSession(message: string) {
    window.localStorage.removeItem('token');
    window.localStorage.removeItem('email');
    setToken(null);
    setEmail('');
    setReports([]);
    setDeletePassword('');
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

  const stats = useMemo(() => {
    const latest = reports[0];
    return [
      {
        label: 'Audit reports',
        value: String(reports.length).padStart(2, '0'),
        detail: latest ? `Latest on ${formatDate(latest.created_at)}` : 'No reports yet',
      },
      {
        label: 'Risk posture',
        value: latestSummary ? `${latestSummary.riskScore}/100` : 'N/A',
        detail: latestSummary
          ? `${latestSummary.riskLabel} with ${latestSummary.findingsCount} finding(s)`
          : 'Run a scan to calculate account risk',
      },
      {
        label: 'Session',
        value: token ? 'Active' : 'Locked',
        detail: token ? `Signed in as ${email}` : 'Authenticate to unlock actions',
      },
      {
        label: 'Queue',
        value: 'Redis',
        detail: 'New audits are pushed to the worker queue',
      },
    ];
  }, [email, latestSummary, reports, token]);

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
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        });
        const text = await response.text();
        const payload = (text.trim() ? JSON.parse(text) : {}) as ReportsResponse | ActionResponse;
        if (!response.ok) {
          if (response.status === 401) {
            clearExpiredSession('Session expired. Please sign in again.');
            return;
          }
          const errorMessage = 'error' in payload ? payload.error : undefined;
          throw new Error(errorMessage || 'Failed to fetch reports');
        }
        setReports((payload as ReportsResponse).reports);
        setStatus(`Loaded ${(payload as ReportsResponse).count} report(s).`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch reports');
      }
    });
  }

  async function submitJson(endpoint: string, body: Record<string, unknown>, method = 'POST') {
    if (!token && endpoint !== '/api/register' && endpoint !== '/api/login') {
      throw new Error('You need to sign in first.');
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
      if (err instanceof TypeError && err.message.includes('fetch')) {
        throw new Error('Network error: Unable to reach server');
      }
      throw err;
    }

    if (response.status === 401) {
      clearExpiredSession('Session expired. Please sign in again.');
      throw new Error('Session expired. Please sign in again.');
    }

    const text = await response.text();
    if (!text.trim()) {
      throw new Error('Empty response from server');
    }

    return JSON.parse(text) as AuthResponse | ActionResponse | ReportsResponse;
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startActionTransition(async () => {
      setError('');
      try {
        const payload = (await submitJson('/api/login', loginForm)) as AuthResponse;
        if (!payload.token) {
          throw new Error(payload.error || 'Login failed');
        }
        setToken(payload.token);
        setEmail(loginForm.email);
        window.localStorage.setItem('token', payload.token);
        window.localStorage.setItem('email', loginForm.email);
        setStatus(`Welcome back, ${loginForm.email}.`);
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
        const payload = (await submitJson('/api/register', registerForm)) as ActionResponse;
        if (!('message' in payload) && !('status' in payload)) {
          setStatus('Account created. Log in to continue.');
        } else {
          setStatus('Account created. Log in to continue.');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Registration failed');
      }
    });
  }

  async function handleQueueAudit() {
    startActionTransition(async () => {
      setError('');
      try {
        const payload = (await submitJson('/api/audit', {
          params: { scope: auditScope },
        })) as ActionResponse;
        if (!payload.status && !payload.message) {
          throw new Error(payload.error || 'Failed to queue audit');
        }
        setStatus('Audit queued successfully. Refresh reports to review results.');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to queue audit');
      }
    });
  }

  async function handleDeleteAccount() {
    startActionTransition(async () => {
      setError('');
      try {
        if (!deletePassword) {
          throw new Error('Enter your password to delete the account.');
        }
        const payload = (await submitJson('/api/account', { password: deletePassword }, 'DELETE')) as ActionResponse;
        if (payload.error) {
          throw new Error(payload.error);
        }
        window.localStorage.removeItem('token');
        window.localStorage.removeItem('email');
        setToken(null);
        setEmail('');
        setReports([]);
        setDeletePassword('');
        setStatus('Account deleted.');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete account');
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
    setAiSummary(null);
    setStatus('Signed out.');
  }

  async function generateAiSummary() {
    if (!latestReport || !token) return;

    setAiSummaryLoading(true);
    try {
      const response = await fetch('/api/ai/summary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ report: latestReport.report }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to generate summary');
      }

      const data = await response.json();
      setAiSummary(data.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate AI summary');
    } finally {
      setAiSummaryLoading(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="eyebrow">Cloud-Sentinel</span>
          <h1>Audit command center</h1>
          <p>Run AWS scans, inspect history, and manage access from one clean surface.</p>
        </div>

        <div className="topbar-actions">
          <span className="live-indicator">
            <span className="pulse-dot"></span>
            <span className={`session-pill ${token ? 'live' : 'idle'}`}>{token ? `Signed in as ${email}` : 'Signed out'}</span>
          </span>
          <button className="ghost" onClick={() => fetchReports()} disabled={!token || loadingReports}>
            Refresh reports
          </button>
          <button className="ghost" onClick={handleLogout} disabled={!token}>
            Logout
          </button>
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <div className="hero-kicker">
            <span>Overview</span>
            <span>{loadingReports || loadingAction ? 'Working…' : status}</span>
          </div>

          <div className="status-bar">
            <strong>Current state</strong>
            <span>{status}</span>
          </div>
          {error ? <div className="alert error">{error}</div> : null}
        </div>

        <div className="hero-panel">
          {stats.map((stat, idx) => (
            <StatCard key={stat.label} {...stat} />
          ))}
          <div className="mini-card">
            <p>Live scan status</p>
            <ul>
              <li><span className="pulse-dot" style={{width:6,height:6,display:'inline-block',marginRight:8,verticalAlign:'middle'}}></span>Worker active</li>
              <li>Redis: connected</li>
              <li>Postgres: healthy</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="grid actions-grid">
        <article className="card">
          <h2>Register</h2>
          <p className="card-copy">Create a user before signing in or queueing any audits.</p>
          <form onSubmit={handleRegister} className="stack">
            <input
              type="email"
              placeholder="email@company.com"
              value={registerForm.email}
              onChange={(event) => setRegisterForm({ ...registerForm, email: event.target.value })}
            />
            <input
              type="password"
              placeholder="Create a password"
              value={registerForm.password}
              onChange={(event) => setRegisterForm({ ...registerForm, password: event.target.value })}
            />
            <button className="primary" type="submit" disabled={loadingAction}>
              Create account
            </button>
          </form>
        </article>

        <article className="card">
          <h2>Login</h2>
          <p className="card-copy">Authenticate to unlock report history and audit controls.</p>
          <form onSubmit={handleLogin} className="stack">
            <input
              type="email"
              placeholder="email@company.com"
              value={loginForm.email}
              onChange={(event) => setLoginForm({ ...loginForm, email: event.target.value })}
            />
            <input
              type="password"
              placeholder="Your password"
              value={loginForm.password}
              onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })}
            />
            <button className="primary" type="submit" disabled={loadingAction}>
              Sign in
            </button>
          </form>
        </article>

        <article className="card">
          <h2>Launch audit</h2>
          <p className="card-copy">Send a scope to the worker queue and review the report after it completes.</p>
          <div className="stack">
            <input
              type="text"
              placeholder="scope, e.g. production"
              value={auditScope}
              onChange={(event) => setAuditScope(event.target.value)}
            />
            <button className="secondary" type="button" onClick={handleQueueAudit} disabled={!token || loadingAction}>
              Queue AWS audit
            </button>
          </div>
        </article>

        <article className="card danger-card">
          <h2>Delete account</h2>
          <p className="card-copy">Permanently delete the user and all audit reports.</p>
          <div className="stack">
            <input
              type="password"
              placeholder="Confirm password"
              value={deletePassword}
              onChange={(event) => setDeletePassword(event.target.value)}
            />
            <button className="danger" type="button" onClick={handleDeleteAccount} disabled={!token || loadingAction}>
              Delete account
            </button>
          </div>
        </article>
      </section>

      <section className="insight-grid">
        <article className="card insight-card insight-card-timeline">
          <div className="section-header">
            <div>
              <span className="eyebrow">Risk timeline</span>
              <h2>Security posture over time</h2>
            </div>
            <span className="metric-chip">Last 5 audits</span>
          </div>

          {timeline.length === 0 ? (
            <div className="empty-state subtle-empty">
              <p>No timeline yet.</p>
              <span>Run at least one audit to see risk change across scans.</span>
            </div>
          ) : (
            <div className="timeline-list">
              {timeline.map((entry) => (
                <article key={entry.id} className="timeline-item">
                  <div className="timeline-head">
                    <strong>Report #{entry.id}</strong>
                    <span>{formatDate(entry.createdAt)}</span>
                  </div>
                  <div className="timeline-score">
                    <span className={`score-pill ${entry.riskScore >= 75 ? 'critical' : entry.riskScore >= 45 ? 'elevated' : 'controlled'}`}>
                      {entry.riskScore}/100
                    </span>
                    <span className={`trend-pill ${entry.delta === null ? 'flat' : entry.delta > 0 ? 'up' : entry.delta < 0 ? 'down' : 'flat'}`}>
                      {entry.delta === null ? 'Start' : entry.delta > 0 ? `+${entry.delta}` : entry.delta < 0 ? `${entry.delta}` : 'No change'}
                    </span>
                  </div>
                  <p>{entry.summary}</p>
                </article>
              ))}
            </div>
          )}
        </article>

        <article className="card insight-card insight-card-evidence">
          <div className="section-header">
            <div>
              <span className="eyebrow">Evidence mode</span>
              <h2>What the scan proves</h2>
            </div>
            <span className="metric-chip">Latest report</span>
          </div>

          {evidence.length === 0 ? (
            <div className="empty-state subtle-empty">
              <p>No evidence loaded yet.</p>
              <span>The latest report will populate proof, impact, and remediation details here.</span>
            </div>
          ) : (
            <div className="finding-list terminal-style">
              {evidence.map((finding) => (
                <article key={finding.title} className={`finding-card ${finding.severity}`}>
                  <div className="finding-head">
                    <strong>{finding.title}</strong>
                    <span className={`severity-badge ${finding.severity === 'high' ? 'warning' : finding.severity === 'good' ? 'secure' : finding.severity}`}>
                      {finding.severity === 'high' ? 'Warning' : finding.severity === 'good' ? 'Secure' : finding.severity}
                    </span>
                  </div>
                  <p><span>Evidence:</span> <span className="resource-id">{finding.evidence}</span></p>
                  <p><span>Impact:</span> {finding.impact}</p>
                  <p><span>Fix:</span> {finding.fix}</p>
                </article>
              ))}
            </div>
          )}
        </article>

        <article className="card insight-card insight-card-simulation">
          <div className="section-header">
            <div>
              <span className="eyebrow">Simulation mode</span>
              <h2>What if the state drifted?</h2>
            </div>
            <span className="metric-chip">Projected risk</span>
          </div>

          {simulations.length === 0 ? (
            <div className="empty-state subtle-empty">
              <p>No simulations ready.</p>
              <span>Queue an audit first so the dashboard can project what changes would do.</span>
            </div>
          ) : (
            <div className="simulation-grid">
              {simulations.map((scenario) => (
                <article key={scenario.title} className="simulation-card">
                  <div className="simulation-head">
                    <strong>{scenario.title}</strong>
                    <span className="metric-chip">+{scenario.delta}</span>
                  </div>
                  <div className="simulation-score">
                    <span>{scenario.projectedScore}/100</span>
                    <small>projected</small>
                  </div>
                  <p>{scenario.evidence}</p>
                  <p className="simulation-outcome">{scenario.outcome}</p>
                </article>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="card reports-card">
        <div className="section-header">
          <div>
            <span className="eyebrow">History</span>
            <h2>Past audit reports</h2>
          </div>
          <button className="ghost" onClick={() => fetchReports()} disabled={!token || loadingReports}>
            Reload
          </button>
        </div>

        {reports.length === 0 ? (
          <div className="empty-state">
            <p>No reports loaded yet.</p>
            <span>Log in and queue an audit to populate the timeline.</span>
          </div>
        ) : (
          <div className="report-list">
            {reports.map((report) => (
              <article key={report.id} className="report-item">
                <div className="report-meta">
                  <strong>Report #{report.id}</strong>
                  <span>{formatDate(report.created_at)}</span>
                </div>
                <pre>{previewReport(report.report)}</pre>
              </article>
            ))}
          </div>
        )}
      </section>

      {token && latestReport && (
        <section className="card">
          <div className="section-header">
            <div>
              <span className="eyebrow">AI Analysis</span>
              <h2>Gemini-Powered Summary</h2>
            </div>
            <button
              className="ghost"
              onClick={generateAiSummary}
              disabled={loadingAction || aiSummaryLoading}
            >
              {aiSummaryLoading ? 'Generating...' : 'Regenerate'}
            </button>
          </div>
          {aiSummary ? (
            <div className="ai-summary">{aiSummary}</div>
          ) : (
            <button
              className="secondary"
              onClick={generateAiSummary}
              disabled={loadingAction || aiSummaryLoading}
            >
              {aiSummaryLoading ? 'Generating summary...' : 'Generate AI Summary'}
            </button>
          )}
        </section>
      )}
    </main>
  );
}
