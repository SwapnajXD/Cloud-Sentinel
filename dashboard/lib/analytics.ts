// ==============================
// ✅ Types
// ==============================

export type ReportRow = {
  id: number;
  report: Record<string, unknown>;
  created_at: string;
};

export type ScanSummary = {
  scope: string;
  riskScore: number;
  riskLabel: "Critical" | "Elevated" | "Controlled";
  unencryptedBuckets: string[];
  runningInstances: string[];
  mfaEnabled: boolean;
  findingsCount: number;
};

export type InsightFinding = {
  title: string;
  severity: "critical" | "high" | "medium" | "good";
  evidence: string;
  impact: string;
  fix: string;
  resourceArn?: string;
};

export type TimelineEntry = {
  id: number;
  createdAt: string;
  riskScore: number;
  delta: number | null;
  summary: string;
};

// ==============================
// ✅ Safe parsing helpers
// ==============================

function asRecord(value: unknown): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  return {};
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

// ==============================
// ✅ Utility helpers
// ==============================

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function riskLabel(score: number): ScanSummary["riskLabel"] {
  if (score >= 75) return "Critical";
  if (score >= 45) return "Elevated";
  return "Controlled";
}

// ✅ Exported (used in UI)
export function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    timeStyle: "medium",
  }).format(new Date(value));
}

// ==============================
// ✅ Core Logic
// ==============================

// 🔹 Convert raw backend report -> structured summary
export function summarizeReport(reportRow: ReportRow): ScanSummary {
  const report = asRecord(reportRow.report);
  const scan = asRecord(report.scan || {});

  const unencryptedBuckets = asArray(scan.unencrypted_s3_buckets)
    .map((b) => asString(b?.bucket))
    .filter(Boolean);

  const runningInstances = asArray(scan.running_ec2_instances)
    .map((i) => asString(i?.instance_id))
    .filter(Boolean);

  const mfa = asRecord(scan.mfa);
  const mfaEnabled = Boolean(mfa.enabled);

  const findingsCount =
    unencryptedBuckets.length +
    (mfaEnabled ? 0 : 1) +
    (runningInstances.length > 0 ? 1 : 0);

  // Calculates baseline + risk weights up to a 100 max boundary ceiling
  const riskScore = clamp(
    18 +
      unencryptedBuckets.length * 20 +
      runningInstances.length * 6 +
      (mfaEnabled ? 0 : 24),
    0,
    100
  );

  return {
    scope: asString(report.action, "default"),
    riskScore,
    riskLabel: riskLabel(riskScore),
    unencryptedBuckets,
    runningInstances,
    mfaEnabled,
    findingsCount,
  };
}

// 🔹 Convert summary -> user-friendly insights
export function buildEvidence(summary: ScanSummary | null): InsightFinding[] {
  if (!summary) return [];

  const findings: InsightFinding[] = [];

  if (summary.unencryptedBuckets.length > 0) {
    findings.push({
      title: "S3 Encryption Gap",
      severity: "critical",
      evidence: summary.unencryptedBuckets.join(", "),
      impact: "Objects are not encrypted at rest",
      fix: "Enable S3 default encryption",
    });
  }

  if (!summary.mfaEnabled) {
    findings.push({
      title: "MFA Disabled",
      severity: "high",
      evidence: "MFA is not enabled",
      impact: "High risk of account takeover",
      fix: "Enable MFA for IAM user",
    });
  }

  if (summary.runningInstances.length > 0) {
    findings.push({
      title: "Running EC2 Instances",
      severity: "medium",
      evidence: `${summary.runningInstances.length} instance(s) active`,
      impact: "Increases attack surface",
      fix: "Stop or review unused instances",
    });
  }

  // ✅ fallback
  if (findings.length === 0) {
    findings.push({
      title: "No Issues Detected",
      severity: "good",
      evidence: "All checks passed",
      impact: "System is healthy",
      fix: "Maintain configuration",
    });
  }

  return findings;
}

// 🔹 Build timeline from past reports
export function buildTimeline(reports: ReportRow[]): TimelineEntry[] {
  const ordered = reports.slice(0, 5).reverse();

  return ordered.map((r, i) => {
    const summary = summarizeReport(r);
    const prev =
      i > 0 ? summarizeReport(ordered[i - 1]).riskScore : null;

    return {
      id: r.id,
      createdAt: r.created_at,
      riskScore: summary.riskScore,
      delta: prev === null ? null : summary.riskScore - prev,
      summary: summary.riskLabel,
    };
  });
}