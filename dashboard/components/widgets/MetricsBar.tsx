export default function MetricsBar({
  latestSummary,
  reports,
  token,
  email,
}: any) {
  return (
    <div className="grid grid-cols-12 gap-2">
      
      <div className="col-span-3 bg-[#0a0a0f] p-2">
        <div className="text-xs text-slate-500">Risk</div>
        <div className="text-xl text-amber-500">
          {latestSummary?.riskScore ?? "--"}
        </div>
      </div>

      <div className="col-span-3 bg-[#0a0a0f] p-2">
        <div className="text-xs text-slate-500">Reports</div>
        <div className="text-xl text-cyan-400">
          {reports.length}
        </div>
      </div>

      <div className="col-span-3 bg-[#0a0a0f] p-2">
        <div className="text-xs text-slate-500">Findings</div>
        <div className="text-xl text-red-400">
          {latestSummary?.findingsCount ?? 0}
        </div>
      </div>

      <div className="col-span-3 bg-[#0a0a0f] p-2">
        <div className="text-xs text-slate-500">Session</div>
        <div className={token ? "text-green-500" : "text-gray-400"}>
          {token ? email : "LOCKED"}
        </div>
      </div>

    </div>
  );
}