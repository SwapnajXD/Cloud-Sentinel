"use client";

import { useMemo, useState } from "react";
import SummaryStats from "@/components/dashboard/SummaryStats";
import RiskScore from "@/components/dashboard/RiskScore";
import FindingsList from "@/components/dashboard/FindingsList";
import AiSummary from "@/components/dashboard/AiSummary";
import DiffSummary from "@/components/dashboard/DiffSummary";
import ThreatScope from "@/components/scope/ThreatScope";

const SEVERITIES = ["all", "critical", "medium", "low", "good"] as const;
type SeverityFilter = (typeof SEVERITIES)[number];

const LABEL: Record<SeverityFilter, string> = {
  all: "All",
  critical: "Critical",
  medium: "Medium",
  low: "Low",
  good: "Good",
};

export default function FindingsPanel({
  report,
  token,
}: {
  report: any;
  token: string;
}) {
  const findings = report?.report?.findings || [];
  const diff = report?.report?.diff;
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{ type: string; resource: string } | null>(null);

  const filtered = useMemo(() => {
    return findings.filter((f: any) => {
      if (severityFilter !== "all" && f.severity !== severityFilter) return false;
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        const haystack = `${f.title || ""} ${f.type || ""} ${f.resource || ""} ${f.category || ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [findings, severityFilter, query]);

  return (
    <div className="space-y-6 min-w-0">
      <DiffSummary diff={diff} />

      <div className="grid md:grid-cols-[minmax(0,260px)_1fr] gap-6 items-start">
        <div className="rounded-xl2 border border-grid bg-panel p-4">
          <ThreatScope findings={findings} onSelect={(f) => setSelected({ type: f.type, resource: f.resource })} />
        </div>
        <div className="space-y-6">
          {typeof report?.report?.risk_score === "number" && (
            <RiskScore
              score={report.report.risk_score}
              grade={report.report.risk_grade}
              cisSummary={report.report.cis_summary}
            />
          )}
          {/* Summary always reflects ALL findings, independent of the filters below */}
          <SummaryStats findings={findings} />
        </div>
      </div>

      <AiSummary report={report} token={token} />

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="flex gap-2 flex-wrap">
          {SEVERITIES.map((s) => (
            <button
              key={s}
              onClick={() => setSeverityFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                severityFilter === s
                  ? "bg-panel2 border-haze text-mist"
                  : "border-grid text-haze hover:text-mist"
              }`}
            >
              {LABEL[s]}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search findings…"
          className="rounded-lg bg-panel2 border border-grid px-3 py-2 text-sm text-mist placeholder:text-haze/60 focus:border-signal outline-none transition sm:w-56"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl2 border border-grid bg-panel p-8 text-center text-sm text-haze">
          No findings match this filter.
        </div>
      ) : (
        <FindingsList findings={filtered} selected={selected} />
      )}
    </div>
  );
}
