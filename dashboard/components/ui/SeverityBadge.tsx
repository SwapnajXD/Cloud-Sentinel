type Severity = "critical" | "medium" | "low" | "good" | string;

const LABEL: Record<string, string> = {
  critical: "Critical",
  medium: "Medium",
  low: "Low",
  good: "Good",
};

const COLOR: Record<string, string> = {
  critical: "var(--critical)",
  medium: "var(--medium)",
  low: "var(--low)",
  good: "var(--good)",
};

export default function SeverityBadge({ severity }: { severity: Severity }) {
  const key = COLOR[severity] ? severity : "low";
  const color = COLOR[key];
  const label = LABEL[key] || severity;

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium mono"
      style={{
        color,
        backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}
