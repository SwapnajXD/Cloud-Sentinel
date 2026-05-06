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

const emptyCredentials: Credentials = {
  email: '',
  password: '',
};

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
  }, [email, reports, token]);

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
        const payload = (await response.json()) as ReportsResponse | ActionResponse;
        if (!response.ok) {
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

    const response = await fetch(endpoint, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

    return (await response.json()) as AuthResponse | ActionResponse | ReportsResponse;
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
    setStatus('Signed out.');
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
          <span className={`session-pill ${token ? 'live' : 'idle'}`}>{token ? `Signed in as ${email}` : 'Signed out'}</span>
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
          {stats.map((stat) => (
            <StatCard key={stat.label} {...stat} />
          ))}
          <div className="mini-card">
            <p>Core routes</p>
            <ul>
              <li>/api/register</li>
              <li>/api/login</li>
              <li>/api/audit</li>
              <li>/api/reports</li>
              <li>/api/account</li>
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
    </main>
  );
}
