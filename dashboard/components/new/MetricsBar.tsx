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

      <div className="bg-[#FFF2DB] p-5 rounded-xl text-center shadow hover:shadow-md transition">
        <p className="text-sm text-red-600 font-medium">🔥 Critical</p>
        <p className="text-3xl font-bold mt-2">{critical}</p>
      </div>

      <div className="bg-[#FFF2DB] p-5 rounded-xl text-center shadow hover:shadow-md transition">
        <p className="text-sm text-yellow-600 font-medium">⚠️ Medium</p>
        <p className="text-3xl font-bold mt-2">{medium}</p>
      </div>

      <div className="bg-[#FFF2DB] p-5 rounded-xl text-center shadow hover:shadow-md transition">
        <p className="text-sm text-green-600 font-medium">✅ Healthy</p>
        <p className="text-3xl font-bold mt-2">{good}</p>
      </div>

    </div>
  );
}