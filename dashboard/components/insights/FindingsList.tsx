export default function FindingsList({ evidence }: any) {
  if (!evidence.length) {
    return (
      <div className="bg-[#0a0a0f] border border-slate-800 border-dashed p-3 text-center">
        <span className="text-[10px] font-mono text-slate-500">
          NO FINDINGS
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {evidence.map((f: any, i: number) => (
        <div
          key={i}
          className="bg-[#0a0a0f] border border-slate-800 p-2"
        >
          <div className="flex justify-between">
            <span>{f.title}</span>
            <span>{f.severity}</span>
          </div>

          <div className="text-xs text-slate-400">
            {f.evidence}
          </div>
        </div>
      ))}
    </div>
  );
}