"use client";

import { useEffect, useState } from "react";
import { getReports, queueAudit } from "@/lib/api";
import ReportCard from "@/components/new/ReportCard";
import MetricsBar from "@/components/new/MetricsBar";
import SeverityChart from "@/components/new/SeverityChart";
import TrendChart from "@/components/new/TrendChart";
import StackedSeverityChart from "@/components/new/StackedSeverityChart";

export default function Page() {
  const [reports, setReports] = useState<any[]>([]);
  const [token, setToken] = useState("");
  const [isDarkMode, setIsDarkMode] = useState(false);

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
    await queueAudit(token, "default", mode);
    setTimeout(() => fetchReports(token), 1500);
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
            <button onClick={() => runScan("aws")} className="px-4 py-2 text-sm font-semibold rounded-lg bg-critical text-white hover:opacity-90 transition shadow-sm">
              🔍 AWS Scan
            </button>
            <button onClick={() => runScan("floci")} className="px-4 py-2 text-sm font-semibold rounded-lg bg-accent text-white hover:opacity-90 transition shadow-sm">
              🧪 Floci Scan
            </button>
            <button onClick={toggleDarkMode} className="p-2 rounded-lg bg-cardBg border border-brandBorder hover:opacity-80 transition">
              {isDarkMode ? "☀️" : "🌙"}
            </button>
          </div>
        </div>

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