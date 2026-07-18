"use client";

type BeaconState = "idle" | "scanning" | "alert";

const COLORS: Record<BeaconState, string> = {
  idle: "var(--good)",
  scanning: "var(--signal)",
  alert: "var(--critical)",
};

export default function BeaconDot({ state = "idle" }: { state?: BeaconState }) {
  const color = COLORS[state];
  return (
    <span className="relative inline-flex h-2.5 w-2.5" aria-hidden="true">
      {state === "scanning" && (
        <span
          className="absolute inline-flex h-full w-full rounded-full sentinel-ping"
          style={{ backgroundColor: color }}
        />
      )}
      <span
        className="relative inline-flex h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: color }}
      />
    </span>
  );
}
