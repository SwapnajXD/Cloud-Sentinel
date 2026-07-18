"use client";

export default function DiffSummary({ diff }: { diff: any }) {
  if (!diff || !diff.has_previous_scan) return null;
  if (diff.new_count === 0 && diff.resolved_count === 0) {
    return (
      <div className="rounded-lg border border-good/30 bg-good/10 text-good text-sm px-4 py-2.5">
        No change since your last scan — {diff.persisting_count} finding
        {diff.persisting_count === 1 ? "" : "s"} still outstanding.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-grid bg-panel2 text-sm px-4 py-2.5 flex flex-wrap gap-x-4 gap-y-1">
      {diff.new_count > 0 && (
        <span className="text-signal font-medium">
          {diff.new_count} new since last scan
        </span>
      )}
      {diff.resolved_count > 0 && (
        <span className="text-good font-medium">
          {diff.resolved_count} resolved since last scan
        </span>
      )}
      {diff.persisting_count > 0 && (
        <span className="text-haze">{diff.persisting_count} still outstanding</span>
      )}
    </div>
  );
}
