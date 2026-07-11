export default function ReportCard({ report }: any) {
  const data = report.report;
  const findings = data?.findings || [];
  const summary = data?.summary;

  return (
    <div className="bg-card-bg border border-black/10 dark:border-white/10 rounded-xl p-5 shadow-lg shadow-neutral-200/40 dark:shadow-black/30 hover:shadow-xl hover:border-black/20 dark:hover:border-white/20 hover:-translate-y-0.5 transition-all duration-200">

      {/* HEADER */}
      <div className="flex justify-between items-center text-sm mb-4 pb-2 border-b border-black/5 dark:border-white/5">
        <div className="flex flex-col">
          <span className="font-semibold text-foreground flex items-center gap-1.5">
            📊 Audit Report
          </span>

          {/* ✅ NEW SUMMARY */}
          {summary && (
            <span className="text-xs text-gray-500 mt-1">
              🔥 {summary.critical} Critical • ⚠️ {summary.medium} Medium • ✅ {summary.good}
            </span>
          )}
        </div>

        <span className="text-xs font-medium text-gray-400 dark:text-gray-500">
          {new Date(report.created_at).toLocaleString()}
        </span>
      </div>

      {/* FINDINGS */}
      <div className="space-y-4">
        {findings.map((f: any, i: number) => (
          <div
            key={i}
            className="p-4 rounded-lg bg-background/40 border border-black/5 dark:border-white/5 hover:bg-background/80 transition duration-150 shadow-sm"
          >

            {/* ✅ TOP ROW */}
            <div className="flex justify-between items-start">
              <div>

                {/* TITLE */}
                <p className="font-semibold text-sm text-foreground flex items-center gap-2">
                  {f.severity === "critical" && "🔥"}
                  {f.severity === "medium" && "⚠️"}
                  {f.severity === "good" && "✅"}
                  {f.title || f.type}
                </p>

                {/* CATEGORY + RESOURCE */}
                <div className="flex gap-2 mt-1">
                  {f.category && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700">
                      {f.category}
                    </span>
                  )}

                  {f.resource && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800">
                      {f.resource}
                    </span>
                  )}
                </div>
              </div>

              {/* SEVERITY BADGE */}
              <span
                className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                  f.severity === "critical"
                    ? "bg-critical/10 text-critical border-critical/20"
                    : f.severity === "medium"
                    ? "bg-medium/10 text-medium border-medium/20"
                    : "bg-healthy/10 text-healthy border-healthy/20"
                }`}
              >
                {f.severity}
              </span>
            </div>

            {/* DESCRIPTION */}
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-3 leading-relaxed">
              {f.description || f.details}
            </p>

            {/* IMPACT */}
            {f.impact && (
              <p className="text-xs mt-3">
                <span className="font-semibold">Impact:</span> {f.impact}
              </p>
            )}

            {/* REMEDIATION */}
            {f.remediation && (
              <p className="text-xs mt-1">
                <span className="font-semibold text-green-700 dark:text-green-400">
                  Fix:
                </span>{" "}
                {f.remediation}
              </p>
            )}

          </div>
        ))}
      </div>
    </div>
  );
}