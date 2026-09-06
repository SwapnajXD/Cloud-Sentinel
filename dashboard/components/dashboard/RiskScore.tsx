"use client";

const GRADE_COLOR: Record<string, string> = {
  A: "var(--good)",
  B: "var(--good)",
  C: "var(--medium)",
  D: "var(--critical)",
  F: "var(--critical)",
};

export default function RiskScore({
  score,
  grade,
  cisSummary,
}: {
  score: number;
  grade: string;
  cisSummary?: {
    version: string;
    controls_assessed: number;
    controls_passing: number;
    controls_failing: number;
  };
}) {
  const color = GRADE_COLOR[grade] || "var(--haze)";

  return (
    <div className="rounded-xl2 border border-grid bg-panel p-6 flex flex-col sm:flex-row gap-6 sm:items-center">
      <div className="flex items-center gap-4 shrink-0">
        <div
          className="relative flex items-center justify-center rounded-full shrink-0"
          style={{
            width: 84,
            height: 84,
            background: `conic-gradient(${color} ${score * 3.6}deg, var(--panel2) 0deg)`,
          }}
        >
          <div className="absolute inset-[6px] rounded-full bg-panel flex flex-col items-center justify-center">
            <span className="display text-2xl font-bold leading-none" style={{ color }}>
              {score}
            </span>
          </div>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-haze font-medium mb-1">
            Security Score
          </p>
          <p className="display text-3xl font-bold" style={{ color }}>
            Grade {grade}
          </p>
        </div>
      </div>

      {cisSummary && cisSummary.controls_assessed > 0 && (
        <div className="sm:border-l sm:border-grid sm:pl-6 flex-1 min-w-0">
          <p className="text-xs uppercase tracking-wider text-haze font-medium mb-1.5">
            Compliance
          </p>
          <p className="text-sm text-mist mb-2">{cisSummary.version}</p>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 rounded-full bg-panel2 overflow-hidden">
              <div
                className="h-full bg-good transition-all"
                style={{
                  width: `${(cisSummary.controls_passing / cisSummary.controls_assessed) * 100}%`,
                }}
              />
            </div>
            <span className="text-sm text-haze whitespace-nowrap">
              {cisSummary.controls_passing}/{cisSummary.controls_assessed} controls passing
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
