"use client";

import { useEffect, useState } from "react";
import { getReports, queueAudit, getTaskStatus } from "@/lib/api";
import ReportCard from "@/components/new/ReportCard";
import MetricsBar from "@/components/new/MetricsBar";
import SeverityChart from "@/components/new/SeverityChart";
import TrendChart from "@/components/new/TrendChart";
import StackedSeverityChart from "@/components/new/StackedSeverityChart";

export default function Page() {
  const [reports, setReports] = useState<any[]>([]);
  const [token, setToken] = useState("");
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [scanStatus, setScanStatus] = useState<
    { mode: string; state: "running" | "done" | "error"; error?: string } | null
  >(null);

  useEffect(() => {
    const isDark = localStorage.getItem("theme") === "dark";
    setIsDarkMode(isDark);
    document.documentElement.classList.toggle("dark", isDark);
    
    const t = localStorage.getItem("token");
    if (t) {
      setToken(t);
      fetchReports(t);
    }
  }, []);

  const toggleDarkMode = () => {
    const next = !isDarkMode;
    setIsDarkMode(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  async function fetchReports(tk: string) {
    try {
      const res = await getReports(tk);
      if (res?.reports) {
        setReports(res.reports.sort((a: any, b: any) => 
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        ));
      }
    } catch (err) { console.error("Fetch failed", err); }
  }

  async function runScan(mode: "aws" | "floci") {
    setScanStatus({ mode, state: "running" });

    try {
      const { task_id } = await queueAudit(token, "default", mode);
      if (!task_id) {
        // Gateway didn't return a task_id (older server) - fall back to the
        // previous best-effort behavior instead of hanging forever.
        setTimeout(() => fetchReports(token), 1500);
        setScanStatus(null);
        return;
      }

      // Poll every 2s, give up after ~2 minutes so a stuck worker can't
      // leave the UI spinning forever.
      const maxAttempts = 60;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((r) => setTimeout(r, 2000));

        const taskStatus = await getTaskStatus(token, task_id);

        if (taskStatus.status === "done") {
          setScanStatus({ mode, state: "done" });
          await fetchReports(token);
          setTimeout(() => setScanStatus(null), 2000);
          return;
        }

        if (taskStatus.status === "error") {
          setScanStatus({ mode, state: "error", error: taskStatus.error || "Scan failed" });
          return;
        }
        // else: still queued/running - keep polling
      }

      setScanStatus({ mode, state: "error", error: "Timed out waiting for scan to finish" });
    } catch (err) {
      console.error("Scan failed", err);
      setScanStatus({ mode, state: "error", error: "Failed to start scan" });
    }
  }

  const calculateRisk = () => {
    const latest = reports[0];
    if (!latest?.report?.findings) return 0;
    let risk = 100;
    latest.report.findings.forEach((f: any) => {
      if (f.severity === "critical") risk -= 10;
      else if (f.severity === "medium") risk -= 5;
    });
    return Math.max(risk, 0);
  };

  const riskScore = calculateRisk();

  return (
    <div className="min-h-screen bg-appBg text-appFg p-6 md:p-10 transition-colors duration-300">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* HEADER */}
        <div className="flex flex-col md:flex-row justify-between items-center border-b border-brandBorder pb-6 gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight uppercase">Cloud Sentinel</h1>
            <p className="text-xs opacity-60">Security Operations Center</p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => runScan("aws")}
              disabled={scanStatus?.state === "running"}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-critical text-white hover:opacity-90 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              🔍 AWS Scan
            </button>
            <button
              onClick={() => runScan("floci")}
              disabled={scanStatus?.state === "running"}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-accent text-white hover:opacity-90 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              🧪 Floci Scan
            </button>
            <button onClick={toggleDarkMode} className="p-2 rounded-lg bg-cardBg border border-brandBorder hover:opacity-80 transition">
              {isDarkMode ? "☀️" : "🌙"}
            </button>
          </div>
        </div>

        {scanStatus && (
          <div
            className={`rounded-xl px-4 py-3 text-sm font-medium border ${
              scanStatus.state === "running"
                ? "bg-cardBg border-brandBorder opacity-80"
                : scanStatus.state === "done"
                ? "bg-green-50 border-green-300 text-green-800 dark:bg-green-900/30 dark:border-green-700 dark:text-green-300"
                : "bg-red-50 border-red-300 text-red-800 dark:bg-red-900/30 dark:border-red-700 dark:text-red-300"
            }`}
          >
            {scanStatus.state === "running" && `⏳ Running ${scanStatus.mode.toUpperCase()} scan...`}
            {scanStatus.state === "done" && `✅ ${scanStatus.mode.toUpperCase()} scan complete`}
            {scanStatus.state === "error" && `❌ ${scanStatus.mode.toUpperCase()} scan failed: ${scanStatus.error}`}
          </div>
        )}

        {/* RISK SCORE */}
        <div className="bg-cardBg border border-brandBorder rounded-2xl p-6 shadow-sm">
          <div className="flex justify-between items-center mb-4">
            <span className="font-semibold uppercase text-xs tracking-wider opacity-70">⚡ Risk Score</span>
            <span className="text-3xl font-bold text-critical">{riskScore}%</span>
          </div>
          <div className="w-full h-3 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-critical transition-all duration-500" style={{ width: `${riskScore}%` }} />
          </div>
        </div>

        <MetricsBar reports={reports} />

        {/* CHARTS */}
        <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-cardBg border border-brandBorder rounded-2xl p-6">
                <SeverityChart reports={reports} />
            </div>
            <div className="bg-cardBg border border-brandBorder rounded-2xl p-6">
                <TrendChart reports={reports} />
            </div>
            <div className="bg-cardBg border border-brandBorder rounded-2xl p-6 md:col-span-2">
                <StackedSeverityChart reports={reports} />
            </div>
        </div>

        {/* REPORTS */}
        <div className="space-y-6">
          <h2 className="text-xl font-bold">Audit Reports</h2>
          <div className="grid md:grid-cols-2 gap-6">
            {reports.map((r, i) => (
              <div key={i} className="bg-cardBg border border-brandBorder rounded-2xl p-4 transition hover:border-gray-500">
                <ReportCard report={r} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}