"use client";

import RadarSweep from "@/components/sentinel/RadarSweep";

export default function EmptyState() {
  return (
    <div className="rounded-xl2 border border-grid bg-panel p-12 flex flex-col items-center text-center">
      <div className="mb-6 opacity-70">
        <RadarSweep size={140} />
      </div>
      <h2 className="display text-lg font-bold mb-2">No scans yet</h2>
      <p className="text-sm text-haze max-w-xs">
        Run an AWS or Floci scan above to see what&rsquo;s exposed on your
        perimeter.
      </p>
    </div>
  );
}
