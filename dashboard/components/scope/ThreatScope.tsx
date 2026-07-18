"use client";

import { useMemo } from "react";

const CATEGORY_ORDER = ["S3", "EC2", "IAM", "RDS", "Lambda", "Correlated"];
const SEVERITY_RADIUS: Record<string, number> = {
  critical: 70,
  medium: 120,
  low: 170,
  good: 210,
};
const SEVERITY_COLOR: Record<string, string> = {
  critical: "var(--critical)",
  medium: "var(--medium)",
  low: "var(--low)",
  good: "var(--good)",
};

const CENTER = 230;
const SIZE = 460;

function angleForCategory(category: string): number {
  const idx = CATEGORY_ORDER.indexOf(category);
  return (idx === -1 ? CATEGORY_ORDER.length - 1 : idx) * (360 / CATEGORY_ORDER.length);
}

/** Deterministic jitter so blips don't reposition on every re-render, but
 * don't perfectly overlap when several findings share a category+severity. */
function hashJitter(seed: string, range: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const normalized = (Math.abs(h) % 1000) / 1000;
  return (normalized - 0.5) * 2 * range;
}

function polarToXY(angleDeg: number, radius: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180; // -90 so 0deg points up
  return { x: CENTER + radius * Math.cos(rad), y: CENTER + radius * Math.sin(rad) };
}

export default function ThreatScope({
  findings,
  onSelect,
}: {
  findings: any[];
  onSelect?: (finding: any) => void;
}) {
  const blips = useMemo(() => {
    return findings.map((f) => {
      const category = CATEGORY_ORDER.includes(f.category) ? f.category : "Correlated";
      const seed = `${f.type || ""}${f.resource || ""}`;
      const baseAngle = angleForCategory(category);
      const angle = baseAngle + hashJitter(seed, 22);
      const baseRadius = SEVERITY_RADIUS[f.severity] ?? SEVERITY_RADIUS.low;
      const radius = Math.min(215, Math.max(20, baseRadius + hashJitter(seed + "r", 14)));
      const { x, y } = polarToXY(angle, radius);
      return { finding: f, x, y, color: SEVERITY_COLOR[f.severity] ?? SEVERITY_COLOR.low };
    });
  }, [findings]);

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full h-auto" role="img" aria-label="Threat scope">
      {/* rings */}
      {Object.values(SEVERITY_RADIUS).map((r) => (
        <circle key={r} cx={CENTER} cy={CENTER} r={r} fill="none" stroke="var(--grid)" strokeWidth={1} />
      ))}

      {/* sector dividers */}
      {CATEGORY_ORDER.map((cat) => {
        const { x, y } = polarToXY(angleForCategory(cat) - 30, 215);
        return (
          <line
            key={cat}
            x1={CENTER}
            y1={CENTER}
            x2={x}
            y2={y}
            stroke="var(--grid)"
            strokeWidth={1}
            strokeDasharray="2 4"
          />
        );
      })}

      {/* category labels */}
      {CATEGORY_ORDER.map((cat) => {
        const { x, y } = polarToXY(angleForCategory(cat), 232);
        return (
          <text
            key={cat}
            x={x}
            y={y}
            fill="var(--haze)"
            fontSize={11}
            textAnchor="middle"
            dominantBaseline="middle"
            className="mono uppercase"
          >
            {cat}
          </text>
        );
      })}

      {/* sweep - a few trailing lines rotating together for a comet-tail effect */}
      <g className="sentinel-sweep" style={{ transformOrigin: `${CENTER}px ${CENTER}px` }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <line
            key={i}
            x1={CENTER}
            y1={CENTER}
            x2={CENTER}
            y2={CENTER - 215}
            stroke="var(--signal)"
            strokeWidth={2}
            opacity={0.32 - i * 0.06}
            transform={`rotate(${-i * 6} ${CENTER} ${CENTER})`}
          />
        ))}
      </g>

      {/* center */}
      <circle cx={CENTER} cy={CENTER} r={3} fill="var(--signal)" />

      {/* blips */}
      {blips.map(({ finding, x, y, color }, i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={finding.severity === "critical" ? 7 : 5}
          fill={color}
          stroke="var(--abyss)"
          strokeWidth={1.5}
          className={finding.severity === "critical" ? "blip-critical cursor-pointer" : "cursor-pointer"}
          onClick={() => onSelect?.(finding)}
        >
          <title>{finding.title || finding.type}</title>
        </circle>
      ))}
    </svg>
  );
}
