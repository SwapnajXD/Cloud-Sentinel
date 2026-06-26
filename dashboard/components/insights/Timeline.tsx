import { formatTime } from "@/lib/analytics";

export default function Timeline({ timeline }: any) {
  if (!timeline.length) {
    return <div>No timeline data</div>;
  }

  return (
    <div className="grid grid-cols-5 gap-1">
      {timeline.map((entry: any) => (
        <div key={entry.id} className="bg-black p-2">
          <div>{entry.riskScore}</div>
          <div className="text-xs">{formatTime(entry.createdAt)}</div>
        </div>
      ))}
    </div>
  );
}
