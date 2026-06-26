'use client';

import {
  summarizeReport,
  buildEvidence,
  buildTimeline,
} from "@/lib/analytics";

import type { ReportRow } from "@/lib/analytics";

import {
  login,
  register,
  getReports,
  queueAudit,
  deleteAccount,
} from "@/lib/api";

import { FormEvent, useEffect, useMemo, useState, useTransition } from 'react';

import Header from "@/components/layout/Header";
import Sidebar from "@/components/layout/Sidebar";
import MetricsBar from "@/components/widgets/MetricsBar";
import AuditActions from "@/components/widgets/AuditActions";
import FindingsList from "@/components/insights/FindingsList";
import TimelineComponent from "@/components/insights/Timeline";
import StatusBar from "@/components/widgets/StatusBar";

// ==============================
// ✅ Types
// ==============================


type Credentials = {
  email: string;
  password: string;
};

const emptyCredentials: Credentials = {
  email: '',
  password: '',
};

// ==============================
// ✅ Component
// ==============================

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

  // ==============================
  // ✅ Derived Data
  // ==============================

  const latestReport = reports[0] || null;

  const latestSummary = useMemo(
    () => (latestReport ? summarizeReport(latestReport) : null),
    [latestReport]
  );

  const timeline = useMemo(() => buildTimeline(reports), [reports]);
  const evidence = useMemo(() => buildEvidence(latestSummary), [latestSummary]);

  // ==============================
  // ✅ Helpers
  // ==============================

  function clearExpiredSession(message: string) {
    window.localStorage.removeItem('token');
    window.localStorage.removeItem('email');
    setToken(null);
    setEmail('');
    setReports([]);
    setStatus(message);
  }

  // ==============================
  // ✅ Effects
  // ==============================

  useEffect(() => {
    const savedToken = window.localStorage.getItem('token');
    const savedEmail = window.localStorage.getItem('email') || '';

    if (savedToken) {
      setToken(savedToken);
      setEmail(savedEmail);
      fetchReports(savedToken);
    }
  }, []);

  // ==============================
  // ✅ API Actions
  // ==============================

  async function fetchReports(activeToken?: string) {
    const authToken = activeToken || token;
    if (!authToken) return;

    setError("");

    startReportsTransition(async () => {
      try {
        const data = await getReports(authToken);
        setReports(data.reports);
        setStatus(`Loaded ${data.count} report(s)`);
      } catch (err) {
        if ((err as Error).message === "Session expired") {
          clearExpiredSession("Session expired");
          return;
        }
        setError((err as Error).message);
      }
    });
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    startActionTransition(async () => {
      try {
        const payload = await login(loginForm.email, loginForm.password);

        setToken(payload.token);
        setEmail(loginForm.email);

        localStorage.setItem("token", payload.token);
        localStorage.setItem("email", loginForm.email);

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
      try {
        await register(registerForm.email, registerForm.password);
        setStatus("Account created. Sign in to continue.");
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Registration failed');
      }
    });
  }

  async function handleQueueAudit() {
    startActionTransition(async () => {
      try {
        if (!token) throw new Error("Not authenticated");

        await queueAudit(token, auditScope);
        setStatus("Audit queued. Refresh to see results.");
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to queue');
      }
    });
  }

  async function handleDeleteAccount() {
    startActionTransition(async () => {
      try {
        if (!token) throw new Error("Not authenticated");
        if (!deletePassword) throw new Error("Enter password");

        await deleteAccount(token, deletePassword);

        localStorage.removeItem("token");
        localStorage.removeItem("email");

        setToken(null);
        setEmail('');
        setReports([]);

        setStatus("Account deleted");
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete');
      }
    });
  }

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("email");

    setToken(null);
    setEmail('');
    setReports([]);

    setLoginForm(emptyCredentials);
    setRegisterForm(emptyCredentials);
    setDeletePassword('');

    setStatus('Signed out');
  }

  // ==============================
  // ✅ UI
  // ==============================

  return (
    <div className="min-h-screen bg-background text-[#eef2ff] font-sans">

      <Header
        token={token}
        email={email}
        scope={latestSummary?.scope}
      />

      <div className="grid grid-cols-12 min-h-[calc(100vh-40px)]">

        <Sidebar
          loginForm={loginForm}
          setLoginForm={setLoginForm}
          handleLogin={handleLogin}
          loadingAction={loadingAction}
        />

        <main className="col-span-10 p-2 space-y-2">

          <MetricsBar
            latestSummary={latestSummary}
            reports={reports}
            token={token}
            email={email}
          />

          <AuditActions
            registerForm={registerForm}
            setRegisterForm={setRegisterForm}
            handleRegister={handleRegister}

            auditScope={auditScope}
            setAuditScope={setAuditScope}
            handleQueueAudit={handleQueueAudit}

            fetchReports={fetchReports}
            handleLogout={handleLogout}

            deletePassword={deletePassword}
            setDeletePassword={setDeletePassword}
            handleDeleteAccount={handleDeleteAccount}

            token={token}
            loadingAction={loadingAction}
            loadingReports={loadingReports}
          />

          <FindingsList evidence={evidence} />

          <TimelineComponent timeline={timeline} />

          {error && (
            <div className="bg-red-900/20 border border-red-600/50 p-2">
              <span className="text-xs text-red-400">ERROR: {error}</span>
            </div>
          )}

          <StatusBar
            status={status}
            loadingReports={loadingReports}
            loadingAction={loadingAction}
          />

        </main>
      </div>
    </div>
  );
}