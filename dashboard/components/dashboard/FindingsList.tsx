"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import SeverityBadge from "@/components/ui/SeverityBadge";

const ORDER = ["critical", "medium", "low", "good"];

function findingId(f: any) {
  return `finding-${f.type}-${f.resource}`;
}

export default function FindingsList({
  findings,
  selected,
}: {
  findings: any[];
  selected?: { type: string; resource: string } | null;
}) {
  if (findings.length === 0) return null;

  const sorted = [...findings].sort(
    (a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity)
  );

  return (
    <div className="rounded-xl2 border border-grid bg-panel divide-y divide-grid">
      {sorted.map((f, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: Math.min(i * 0.03, 0.3) }}
        >
          <FindingRow
            finding={f}
            isSelected={Boolean(
              selected && selected.type === f.type && selected.resource === f.resource
            )}
          />
        </motion.div>
      ))}
    </div>
  );
}

function FindingRow({ finding, isSelected }: { finding: any; isSelected: boolean }) {
  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const description = finding.description || finding.details;
  const hasDetail = Boolean(
    description || finding.remediation || finding.impact || finding.correlates
  );
  const isCorrelated = finding.category === "Correlated";

  useEffect(() => {
    if (isSelected) {
      setOpen(true);
      rowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isSelected]);

  return (
    <div
      id={findingId(finding)}
      ref={rowRef}
      className={`px-5 py-4 transition-colors ${
        isSelected ? "bg-signal/10" : ""
      } ${isCorrelated ? "border-l-2 border-signal" : ""}`}
    >
      <button
        type="button"
        onClick={() => hasDetail && setOpen((o) => !o)}
        className={`w-full flex items-start justify-between gap-4 text-left ${
          hasDetail ? "cursor-pointer" : "cursor-default"
        }`}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <SeverityBadge severity={finding.severity} />
            {finding.is_new && (
              <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-signal text-abyss">
                NEW
              </span>
            )}
            {finding.category && (
              <span className="text-xs text-haze uppercase tracking-wide">
                {finding.category}
              </span>
            )}
            {finding.cis && (
              <span
                className="text-xs px-1.5 py-0.5 rounded border border-signal/40 text-signal mono"
                title={finding.cis.control_title}
              >
                CIS {finding.cis.control_id}
              </span>
            )}
          </div>
          <p className="text-base font-semibold text-mist leading-snug">
            {finding.title || finding.type || "Finding"}
          </p>
          {finding.resource && (
            <p className="text-xs text-haze mono mt-1 truncate">
              {finding.resource}
            </p>
          )}
        </div>
        {hasDetail && (
          <span
            className={`text-haze shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          >
            ⌄
          </span>
        )}
      </button>

      {open && hasDetail && (
        <div className="mt-3 pl-0 space-y-2 text-sm text-haze leading-relaxed border-t border-grid pt-3">
          {description && <p>{description}</p>}
          {finding.cis && (
            <p>
              <span className="text-mist font-semibold">Compliance: </span>
              {finding.cis.version} — {finding.cis.control_id} {finding.cis.control_title}
            </p>
          )}
          {finding.impact && (
            <p>
              <span className="text-mist font-semibold">Impact: </span>
              {finding.impact}
            </p>
          )}
          {finding.remediation && (
            <p>
              <span className="text-mist font-semibold">Fix: </span>
              {finding.remediation}
            </p>
          )}
          {finding.correlates && (
            <p>
              <span className="text-mist font-semibold">Built from: </span>
              {finding.correlates
                .map((c: any) => `${c.type} (${c.resource})`)
                .join(", ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
