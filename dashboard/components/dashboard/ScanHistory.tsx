"use client";

export default function ScanHistory({
  reports,
  selected,
  onSelect,
}: {
  reports: any[];
  selected: number;
  onSelect: (i: number) => void;
}) {
  if (reports.length <= 1) return null;

  return (
    <div className="rounded-xl2 border border-grid bg-panel p-4">
      <p className="text-xs uppercase tracking-wider text-haze font-medium mb-3 px-1">
        Scan history
      </p>
      <div className="space-y-1 max-h-80 overflow-y-auto">
        {reports.map((r, i) => {
          const count = r?.report?.findings?.length ?? 0;
          const critical = (r?.report?.findings || []).filter(
            (f: any) => f.severity === "critical"
          ).length;
          return (
            <button
              key={r.id ?? i}
              onClick={() => onSelect(i)}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition ${
                i === selected
                  ? "bg-panel2 text-mist"
                  : "text-haze hover:bg-panel2/60"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="mono text-xs">
                  {new Date(r.created_at).toLocaleString()}
                </span>
                {critical > 0 && (
                  <span className="text-critical text-xs font-medium">
                    {critical} critical
                  </span>
                )}
              </div>
              <span className="text-xs text-haze">
                {count} finding{count === 1 ? "" : "s"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
