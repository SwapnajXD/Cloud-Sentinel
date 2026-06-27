export default function ReportCard({ report }: any) {
  const findings = report.report?.findings || [];

  return (
    <div className="bg-[#FFF2DB] border border-[#FFE5BF] rounded-xl p-5 shadow-sm hover:shadow-md transition">

      {/* HEADER */}
      <div className="flex justify-between items-center text-sm mb-3">
        <span className="font-semibold text-gray-700">
          📊 Audit Report
        </span>

        <span className="text-xs text-gray-500">
          {new Date(report.created_at).toLocaleString()}
        </span>
      </div>

      {/* FINDINGS */}
      <div className="space-y-3">
        {findings.map((f: any, i: number) => (
          <div
            key={i}
            className="p-3 rounded-lg bg-[#FFE5BF] border border-[#FFD9A0]"
          >

            {/* TOP ROW */}
            <div className="flex justify-between items-center text-sm">
              <span className="flex items-center gap-1 font-medium text-gray-800">
                {f.severity === "critical" && "🔥"}
                {f.severity === "medium" && "⚠️"}
                {f.severity === "good" && "✅"}

                {f.type}
              </span>

              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded ${
                  f.severity === "critical"
                    ? "bg-[#F62440]/20 text-[#F62440]"
                    : f.severity === "medium"
                    ? "bg-yellow-200 text-yellow-700"
                    : "bg-green-200 text-green-700"
                }`}
              >
                {f.severity}
              </span>
            </div>

            {/* DETAILS */}
            <p className="text-xs text-gray-600 mt-1 leading-relaxed">
              {f.details}
            </p>

          </div>
        ))}
      </div>

    </div>
  );
}
