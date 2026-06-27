"use client";

import { useEffect, useState } from "react";
import { getReports, queueAudit } from "@/lib/api";
import ReportCard from "@/components/new/ReportCard";
import MetricsBar from "@/components/new/MetricsBar";
import SeverityChart from "@/components/new/SeverityChart";
import TrendChart from "@/components/new/TrendChart";
import RiskTrendChart from "@/components/new/RiskTrendChart";
import StackedSeverityChart from "@/components/new/StackedSeverityChart";
import CategorySummary from "@/components/new/CategorySummary";


export default function Page() {
  const [reports, setReports] = useState<any[]>([]);
  const [token, setToken] = useState("");
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    const t = localStorage.getItem("token");
    if (t) {
      setToken(t);
      fetchReports(t);
    }
  }, []);

  async function fetchReports(tk?: string) {
    const res = await getReports(tk || token);
      setReports(
        res.reports.sort(
          (a, b) =>
            new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime()
        )
      );
  }

  async function runScan(mode: "aws" | "floci") {
    await queueAudit(token, "default", mode);
    setTimeout(() => fetchReports(), 1200);
  }

  function calculateRisk(reports: any[]) {
    const latest =
      Array.isArray(reports) && reports.length > 0
        ? reports[0]
        : null;
    let risk = 100;
    if (latest && latest.report?.findings) {
      for (const f of latest.report.findings) {
        if (f.severity === "critical") risk -= 10;
        else if (f.severity === "medium") risk -= 5;
      }
    }
    return Math.max(risk, 0);
  }

  function buildRiskTrend(reports: any[]) {
    return (reports || []).map((r: any) => {
      let risk = 100;
      for (const f of (r.report?.findings || [])) {
        if (f.severity === "critical") risk -= 10;
        else if (f.severity === "medium") risk -= 5;
      }
      return {
        time: new Date(r.created_at).toLocaleTimeString(),
        risk: Math.max(risk, 0),
      };
    }).reverse();
  }

  // ✅ FILTER LOGIC (ADDED)
  const filteredReports = reports.filter((r) => {
    if (filter === "all") return true;
    return r.report.findings.some((f: any) => f.severity === filter);
  });

  return (
    <div className="min-h-screen bg-[#FFFAF3] text-gray-800">

      <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">

        {/* HEADER */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">☁️ Cloud Sentinel</h1>
            <p className="text-sm text-gray-500">
              Cloud Security Dashboard
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => runScan("aws")}
              className="bg-[#F62440] text-white px-4 py-2 rounded-lg shadow hover:scale-105 transition"
            >
              🔍 AWS Scan
            </button>

            <button
              onClick={() => runScan("floci")}
              className="bg-[#FFE5BF] px-4 py-2 rounded-lg hover:bg-[#FFD8A8] transition"
            >
              🧪 Floci Scan
            </button>
          </div>
        </div>

        {/* ✅ RISK CARD (IMPROVED STRUCTURE) */}
        <div className="bg-[#FFF2DB] rounded-2xl p-6 shadow hover:shadow-lg transition">
          <div className="flex justify-between items-center">
            
            {/* LEFT SIDE */}
            <div>
              <span className="text-lg font-medium">⚡ Risk Score</span>

              {/* ✅ STATUS LABEL (FIXED POSITION) */}
              <p className="text-sm mt-1 text-gray-600">
                {calculateRisk(reports) > 80 && "✅ Healthy"}
                {calculateRisk(reports) <= 80 && calculateRisk(reports) > 50 && "⚠️ Moderate"}
                {calculateRisk(reports) <= 50 && "🚨 Dangerous"}
              </p>
            </div>

            {/* RIGHT SIDE (BIG NUMBER) */}
            <span className="text-4xl font-bold text-[#F62440]">
              {calculateRisk(reports)}%
            </span>

          </div>

          <div className="mt-4 h-3 bg-[#FFE5BF] rounded-full overflow-hidden">
            <div
              className="h-3 bg-[#F62440] rounded-full"
              style={{ width: `${calculateRisk(reports)}%` }}
            />
          </div>
        </div>

        {/* ✅ METRICS WITH TITLE */}
        <div className="space-y-2">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            📈 Metrics
          </h2>
          <MetricsBar reports={reports} />
        </div>


        {/* ✅ CHART */}
        <SeverityChart reports={reports} />

        {/* ✅ TREND CHART */}
        <TrendChart reports={reports} />

        <CategorySummary reports={reports} />
          
        <StackedSeverityChart reports={reports} />
          
        <RiskTrendChart reports={reports} />
  
        {/* ✅ FILTERS (IMPROVED UI) */}
        <div className="flex gap-3">
          {["all", "critical", "medium"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
                filter === f
                  ? "bg-[#F62440] text-white shadow"
                  : "bg-[#FFF2DB] hover:bg-[#FFE5BF]"
              }`}
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>

        {/* ✅ ALERT */}
        {reports.some(r =>
          r.report.findings.some((f: any) => f.severity === "critical")
        ) && (
          <div className="bg-[#F62440]/10 border border-[#F62440]/40 p-4 rounded-xl flex gap-3 items-center">
            <span className="text-xl">🚨</span>
            <div>
              <p className="font-semibold text-[#F62440]">
                Critical Issues Found
              </p>
              <p className="text-sm text-gray-600">
                Immediate action recommended
              </p>
            </div>
          </div>
        )}

        {/* ✅ REPORTS */}
        <div className="space-y-5">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            📊 Audit Reports
          </h2>

          {reports.length === 0 ? (
            // ✅ BETTER EMPTY STATE
            <div className="bg-[#FFF2DB] p-10 rounded-xl text-center shadow">
              <p className="text-lg font-medium">🚀 No reports yet</p>
              <p className="text-sm text-gray-500 mt-2">
                Run a scan to analyze your cloud
              </p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-8">
              {filteredReports.map((r, i) => (
                <ReportCard key={i} report={r} />
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
