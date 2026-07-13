"use client";

import { useMemo, useState } from "react";
import SummaryStats from "@/components/dashboard/SummaryStats";
import FindingsList from "@/components/dashboard/FindingsList";
import AiSummary from "@/components/dashboard/AiSummary";

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
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [query, setQuery] = useState("");

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
      {/* Summary always reflects ALL findings, independent of the filters below */}
      <SummaryStats findings={findings} />

      <AiSummary report={report} token={token} />

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="flex gap-2 flex-wrap">
          {SEVERITIES.map((s) => (
            <button
              key={s}
              onClick={() => setSeverityFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                severityFilter === s
                  ? "bg-panel2 border-slate text-mist"
                  : "border-line text-slate hover:text-mist"
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
          className="rounded-lg bg-panel2 border border-line px-3 py-2 text-sm text-mist placeholder:text-slate/60 focus:border-brass outline-none transition sm:w-56"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl2 border border-line bg-panel p-8 text-center text-sm text-slate">
          No findings match this filter.
        </div>
      ) : (
        <FindingsList findings={filtered} />
      )}
    </div>
  );
}
