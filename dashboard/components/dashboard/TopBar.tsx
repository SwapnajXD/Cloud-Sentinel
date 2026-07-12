"use client";

import BeaconDot from "@/components/sentinel/BeaconDot";
import Button from "@/components/ui/Button";

export default function TopBar({
  email,
  scanning,
  onScan,
  onSignOut,
}: {
  email: string | null;
  scanning: boolean;
  onScan: (mode: "aws" | "floci") => void;
  onSignOut: () => void;
}) {
  return (
    <header className="border-b border-line">
      <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <BeaconDot state={scanning ? "scanning" : "idle"} />
          <div>
            <h1 className="display text-lg font-bold leading-none">Cloud-Sentinel</h1>
            <p className="text-xs text-slate mt-1">
              {scanning ? "Scanning your perimeter…" : "Perimeter watch is idle"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Button variant="primary" onClick={() => onScan("aws")} disabled={scanning}>
            Scan AWS
          </Button>
          <Button variant="secondary" onClick={() => onScan("floci")} disabled={scanning}>
            Scan Floci
          </Button>
          <div className="w-px h-6 bg-line mx-1" />
          <span className="text-xs text-slate hidden sm:inline mono">{email}</span>
          <Button variant="ghost" onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}
