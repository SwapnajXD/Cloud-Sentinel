"use client";

/**
 * The Sweep — Cloud-Sentinel's one signature element. A slow rotating
 * radar line over a dot-grid, standing in for "watching the perimeter".
 * Used in exactly two places: ambient on the login screen (slow, quiet),
 * and as the literal scan-in-progress indicator on the dashboard (fast).
 * Kept out of everywhere else so it stays meaningful.
 */
export default function RadarSweep({
  size = 320,
  active = false,
}: {
  size?: number;
  active?: boolean;
}) {
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <div className="absolute inset-0 rounded-full border border-line" />
      <div className="absolute inset-[16%] rounded-full border border-line" />
      <div className="absolute inset-[32%] rounded-full border border-line" />
      <div className="absolute inset-[48%] rounded-full border border-line" />

      <div
        className={`absolute inset-0 rounded-full overflow-hidden sentinel-sweep ${
          active ? "sentinel-sweep--active" : ""
        }`}
        style={{
          background: `conic-gradient(from 0deg, var(--brass) 0deg, transparent 40deg, transparent 360deg)`,
          opacity: active ? 0.55 : 0.28,
        }}
      />

      <div
        className="absolute rounded-full bg-brass"
        style={{
          width: 8,
          height: 8,
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
        }}
      />
    </div>
  );
}
