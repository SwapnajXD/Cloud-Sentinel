"use client";

import { useState } from "react";
import { getAiSummary } from "@/lib/api";
import Button from "@/components/ui/Button";

export default function AiSummary({ report, token }: { report: any; token: string }) {
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await getAiSummary(token, report.report);
      if (res.summary) {
        setSummary(res.summary);
      } else {
        setError("No summary was generated.");
      }
    } catch (err: any) {
      const msg = String(err?.message || "");
      if (msg.includes("no api key")) {
        setError("AI summaries aren't configured on this server yet (needs GEMINI_API_KEY).");
      } else {
        setError("Couldn't generate a summary right now.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl2 border border-grid bg-panel p-5">
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs uppercase tracking-wider text-haze font-medium">
          AI summary
        </span>
        <Button variant="secondary" onClick={handleGenerate} disabled={loading}>
          {loading ? "Generating…" : summary ? "Regenerate" : "Generate summary"}
        </Button>
      </div>

      {error && <p className="text-sm text-critical mt-3">{error}</p>}
      {summary && (
        <p className="text-sm text-mist mt-3 leading-relaxed whitespace-pre-wrap">{summary}</p>
      )}
      {!summary && !error && (
        <p className="text-sm text-haze mt-3">
          Get a plain-language summary of this scan&rsquo;s findings.
        </p>
      )}
    </div>
  );
}
