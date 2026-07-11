export default function MetricsBar({ reports }: any) {
  const latest =
    Array.isArray(reports) && reports.length > 0
      ? reports[0]
      : null;

  let critical = 0;
  let medium = 0;
  let good = 0;

  if (latest && latest.report && latest.report.findings) {
    for (const f of latest.report.findings) {
      if (f.severity === "critical") {
        critical++;
      } else if (f.severity === "medium") {
        medium++;
      } else if (f.severity === "good") {
        good++;
      }
    }
  }

  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="bg-cardBg border border-brandBorder backdrop-blur-sm p-5 rounded-xl text-center shadow hover:shadow-xl hover:-translate-y-1 transition-all duration-200">
        <p className="text-sm text-[#F62440] font-semibold">🔥 Critical</p>
        <p className="text-3xl font-mono font-bold mt-2 text-appFg">{critical}</p>
      </div>

      <div className="bg-cardBg border border-brandBorder backdrop-blur-sm p-5 rounded-xl text-center shadow hover:shadow-xl hover:-translate-y-1 transition-all duration-200">
        <p className="text-sm text-yellow-600 dark:text-yellow-500 font-semibold">⚠️ Medium</p>
        <p className="text-3xl font-mono font-bold mt-2 text-appFg">{medium}</p>
      </div>

      <div className="bg-cardBg border border-brandBorder backdrop-blur-sm p-5 rounded-xl text-center shadow hover:shadow-xl hover:-translate-y-1 transition-all duration-200">
        <p className="text-sm text-green-600 dark:text-green-500 font-semibold">✅ Healthy</p>
        <p className="text-3xl font-mono font-bold mt-2 text-appFg">{good}</p>
      </div>
    </div>
  );
}