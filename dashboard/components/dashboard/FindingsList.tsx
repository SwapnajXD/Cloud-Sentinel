"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import SeverityBadge from "@/components/ui/SeverityBadge";

const ORDER = ["critical", "medium", "low", "good"];

export default function FindingsList({ findings }: { findings: any[] }) {
  if (findings.length === 0) return null;

  const sorted = [...findings].sort(
    (a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity)
  );

  return (
    <div className="rounded-xl2 border border-line bg-panel divide-y divide-line">
      {sorted.map((f, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: Math.min(i * 0.03, 0.3) }}
        >
          <FindingRow finding={f} />
        </motion.div>
      ))}
    </div>
  );
}

function FindingRow({ finding }: { finding: any }) {
  const [open, setOpen] = useState(false);
  const description = finding.description || finding.details;
  const hasDetail = Boolean(description || finding.remediation || finding.impact);

  return (
    <div className="px-5 py-4">
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
            {finding.category && (
              <span className="text-xs text-slate uppercase tracking-wide">
                {finding.category}
              </span>
            )}
            {finding.cis && (
              <span
                className="text-xs px-1.5 py-0.5 rounded border border-brass/40 text-brass mono"
                title={finding.cis.control_title}
              >
                CIS {finding.cis.control_id}
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-mist">
            {finding.title || finding.type || "Finding"}
          </p>
          {finding.resource && (
            <p className="text-xs text-slate mono mt-1 truncate">
              {finding.resource}
            </p>
          )}
        </div>
        {hasDetail && (
          <span
            className={`text-slate shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          >
            ⌄
          </span>
        )}
      </button>

      {open && hasDetail && (
        <div className="mt-3 pl-0 space-y-2 text-sm text-slate border-t border-line pt-3">
          {description && <p>{description}</p>}
          {finding.cis && (
            <p>
              <span className="text-mist font-medium">Compliance: </span>
              {finding.cis.version} — {finding.cis.control_id} {finding.cis.control_title}
            </p>
          )}
          {finding.impact && (
            <p>
              <span className="text-mist font-medium">Impact: </span>
              {finding.impact}
            </p>
          )}
          {finding.remediation && (
            <p>
              <span className="text-mist font-medium">Fix: </span>
              {finding.remediation}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
