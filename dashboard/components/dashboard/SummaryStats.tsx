"use client";

const ORDER = ["critical", "medium", "low", "good"] as const;

const COLOR: Record<string, string> = {
  critical: "var(--critical)",
  medium: "var(--medium)",
  low: "var(--low)",
  good: "var(--good)",
};

const LABEL: Record<string, string> = {
  critical: "Critical",
  medium: "Medium",
  low: "Low",
  good: "Good",
};

export default function SummaryStats({ findings }: { findings: any[] }) {
  const counts: Record<string, number> = { critical: 0, medium: 0, low: 0, good: 0 };
  findings.forEach((f) => {
    const sev = COLOR[f.severity] ? f.severity : "low";
    counts[sev] = (counts[sev] || 0) + 1;
  });
  const total = findings.length || 1;

  return (
    <div className="rounded-xl2 border border-line bg-panel p-6">
      <div className="flex items-baseline justify-between mb-4">
        <span className="text-xs uppercase tracking-wider text-slate font-medium">
          Latest scan
        </span>
        <span className="text-sm text-slate">
          {findings.length} finding{findings.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex h-2.5 rounded-full overflow-hidden bg-panel2 mb-5">
        {ORDER.map((sev) =>
          counts[sev] > 0 ? (
            <div
              key={sev}
              style={{
                width: `${(counts[sev] / total) * 100}%`,
                backgroundColor: COLOR[sev],
              }}
              title={`${LABEL[sev]}: ${counts[sev]}`}
            />
          ) : null
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {ORDER.map((sev) => (
          <div key={sev}>
            <div className="flex items-center gap-1.5 mb-1">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: COLOR[sev] }}
              />
              <span className="text-xs text-slate">{LABEL[sev]}</span>
            </div>
            <span className="text-2xl font-bold display">{counts[sev]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
