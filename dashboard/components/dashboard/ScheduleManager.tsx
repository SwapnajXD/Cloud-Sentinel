"use client";

import { useState } from "react";
import { createSchedule, deleteSchedule, Schedule, AwsConnection } from "@/lib/api";
import Button from "@/components/ui/Button";

const PRESETS = [
  { label: "Every 6h", hours: 6 },
  { label: "Daily", hours: 24 },
  { label: "Weekly", hours: 168 },
];

export default function ScheduleManager({
  token,
  schedules,
  connections,
  onChanged,
}: {
  token: string;
  schedules: Schedule[];
  connections: AwsConnection[];
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<"aws" | "floci">("aws");
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      // Same "use the first connected account" default as manual scans -
      // a picker for choosing between multiple is a natural next step.
      const connectionId = mode === "aws" && connections.length > 0 ? connections[0].id : undefined;
      await createSchedule(token, mode, hours, connectionId);
      onChanged();
    } catch (err) {
      console.error("Failed to create schedule", err);
      setError("Couldn't create schedule.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteSchedule(token, id);
      onChanged();
    } catch (err) {
      console.error("Failed to delete schedule", err);
    }
  }

  return (
    <div className="rounded-xl2 border border-grid bg-panel p-4">
      <p className="text-xs uppercase tracking-wider text-haze font-medium mb-3 px-1">
        Recurring scans
      </p>

      {schedules.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {schedules.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-2 rounded-lg bg-panel2 border border-grid px-3 py-2 text-xs"
            >
              <div>
                <span className="mono uppercase text-mist">{s.mode}</span>
                <span className="text-haze"> · every {s.interval_hours}h</span>
                <p className="text-haze mt-0.5">
                  Next: {new Date(s.next_run_at).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => handleDelete(s.id)}
                className="text-haze hover:text-critical transition shrink-0"
                aria-label="Delete schedule"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex gap-1.5">
          {(["aws", "floci"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium border transition ${
                mode === m
                  ? "bg-panel2 border-haze text-mist"
                  : "border-grid text-haze hover:text-mist"
              }`}
            >
              {m.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="flex gap-1.5 flex-wrap">
          {PRESETS.map((p) => (
            <button
              key={p.hours}
              onClick={() => setHours(p.hours)}
              className={`px-2.5 py-1 rounded-full text-xs border transition ${
                hours === p.hours
                  ? "bg-signal/15 border-signal/40 text-signal"
                  : "border-grid text-haze hover:text-mist"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {error && <p className="text-xs text-critical">{error}</p>}

        <Button variant="secondary" onClick={handleCreate} disabled={busy} className="w-full">
          {busy ? "Adding…" : "Add schedule"}
        </Button>
      </div>
    </div>
  );
}
