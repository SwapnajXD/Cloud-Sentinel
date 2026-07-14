"use client";

import { useState } from "react";
import { dismissDeadLetterTask, DeadLetterTask } from "@/lib/api";

export default function DeadLetterPanel({
  token,
  tasks,
  onDismissed,
}: {
  token: string;
  tasks: DeadLetterTask[];
  onDismissed: (taskId: string) => void;
}) {
  const [dismissing, setDismissing] = useState<string | null>(null);

  if (tasks.length === 0) return null;

  async function handleDismiss(taskId: string) {
    setDismissing(taskId);
    try {
      await dismissDeadLetterTask(token, taskId);
      onDismissed(taskId);
    } catch (err) {
      console.error("Failed to dismiss dead-letter task", err);
    } finally {
      setDismissing(null);
    }
  }

  return (
    <div className="rounded-xl2 border border-critical/30 bg-critical/5 p-4">
      <p className="text-xs uppercase tracking-wider text-critical font-medium mb-3 px-1">
        Failed scans ({tasks.length})
      </p>
      <div className="space-y-2 max-h-72 overflow-y-auto">
        {tasks.map((t) => (
          <div
            key={t.task_id}
            className="rounded-lg bg-panel border border-line px-3 py-2.5 text-xs"
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="mono text-slate uppercase">{t.mode}</span>
              {t.requested_at && (
                <span className="text-slate">
                  {new Date(t.requested_at).toLocaleString()}
                </span>
              )}
            </div>
            <p className="text-mist mb-2 break-words">
              {t.final_error || "Scan failed after all retries."}
            </p>
            <button
              onClick={() => handleDismiss(t.task_id)}
              disabled={dismissing === t.task_id}
              className="text-slate hover:text-mist transition disabled:opacity-50"
            >
              {dismissing === t.task_id ? "Dismissing…" : "Dismiss"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
