"use client";

/**
 * The Scope — Cloud-Sentinel's signature element. A rotating sweep over a
 * radar field. Used ambiently on the login screen (slow, quiet), and its
 * sweep motion is reused literally inside the dashboard's Threat Scope
 * visualization (fast, functional, sweeping over real findings).
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
      <div className="absolute inset-0 rounded-full border border-grid" />
      <div className="absolute inset-[16%] rounded-full border border-grid" />
      <div className="absolute inset-[32%] rounded-full border border-grid" />
      <div className="absolute inset-[48%] rounded-full border border-grid" />

      <div
        className={`absolute inset-0 rounded-full overflow-hidden sentinel-sweep ${
          active ? "sentinel-sweep--active" : ""
        }`}
        style={{
          background: `conic-gradient(from 0deg, var(--signal) 0deg, transparent 40deg, transparent 360deg)`,
          opacity: active ? 0.55 : 0.28,
        }}
      />

      <div
        className="absolute rounded-full bg-signal"
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
