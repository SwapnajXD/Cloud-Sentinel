"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { getReports, queueAudit, getTaskStatus, getDeadLetterTasks, DeadLetterTask, getSchedules, Schedule, getAwsConnections, AwsConnection } from "@/lib/api";
import TopBar from "@/components/dashboard/TopBar";
import FindingsPanel from "@/components/dashboard/FindingsPanel";
import ScanHistory from "@/components/dashboard/ScanHistory";
import DeadLetterPanel from "@/components/dashboard/DeadLetterPanel";
import ScheduleManager from "@/components/dashboard/ScheduleManager";
import ConnectAwsAccount from "@/components/dashboard/ConnectAwsAccount";
import EmptyState from "@/components/dashboard/EmptyState";
import DeleteAccountModal from "@/components/dashboard/DeleteAccountModal";
import RadarSweep from "@/components/sentinel/RadarSweep";

type ScanBanner =
  | { mode: string; state: "running" }
  | { mode: string; state: "done" }
  | { mode: string; state: "error"; message: string };

export default function DashboardPage() {
  const { token, email, ready, signOut } = useAuth();
  const router = useRouter();

  const [reports, setReports] = useState<any[]>([]);
  const [selected, setSelected] = useState(0);
  const [banner, setBanner] = useState<ScanBanner | null>(null);
  const [loadingReports, setLoadingReports] = useState(true);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deadLetterTasks, setDeadLetterTasks] = useState<DeadLetterTask[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [connections, setConnections] = useState<AwsConnection[]>([]);

  useEffect(() => {
    if (ready && !token) router.replace("/login");
  }, [ready, token, router]);

  const fetchReports = useCallback(async (tk: string) => {
    try {
      const res = await getReports(tk);
      const sorted = (res.reports || []).sort(
        (a: any, b: any) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setReports(sorted);
      setSelected(0);
    } catch (err) {
      console.error("Failed to fetch reports", err);
    } finally {
      setLoadingReports(false);
    }
  }, []);

  const fetchDeadLetterTasks = useCallback(async (tk: string) => {
    try {
      const res = await getDeadLetterTasks(tk);
      setDeadLetterTasks(res.tasks || []);
    } catch (err) {
      console.error("Failed to fetch dead-letter tasks", err);
    }
  }, []);

  const fetchSchedules = useCallback(async (tk: string) => {
    try {
      const res = await getSchedules(tk);
      setSchedules(res.schedules || []);
    } catch (err) {
      console.error("Failed to fetch schedules", err);
    }
  }, []);

  const fetchConnections = useCallback(async (tk: string) => {
    try {
      const res = await getAwsConnections(tk);
      setConnections(res.connections || []);
    } catch (err) {
      console.error("Failed to fetch AWS connections", err);
    }
  }, []);

  useEffect(() => {
    if (token) {
      fetchReports(token);
      fetchDeadLetterTasks(token);
      fetchSchedules(token);
      fetchConnections(token);
    }
  }, [token, fetchReports, fetchDeadLetterTasks, fetchSchedules, fetchConnections]);

  async function runScan(mode: "aws" | "floci") {
    if (!token) return;
    setBanner({ mode, state: "running" });

    // If the user has connected their own AWS account(s), use the first
    // one automatically. With more than one connected, this is a
    // reasonable default for now - a picker to choose between multiple
    // connected accounts is a natural next step, not yet built.
    const connectionId = mode === "aws" && connections.length > 0 ? connections[0].id : undefined;

    try {
      const { task_id } = await queueAudit(token, "default", mode, connectionId);

      if (!task_id) {
        setTimeout(() => fetchReports(token), 1500);
        setBanner(null);
        return;
      }

      const maxAttempts = 60; // ~2 minutes at 2s intervals
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((r) => setTimeout(r, 2000));
        const status = await getTaskStatus(token, task_id);

        if (status.status === "done") {
          setBanner({ mode, state: "done" });
          await fetchReports(token);
          setTimeout(() => setBanner(null), 2500);
          return;
        }
        if (status.status === "error") {
          setBanner({
            mode,
            state: "error",
            message: status.error || "Scan failed",
          });
          fetchDeadLetterTasks(token);
          return;
        }
      }
      setBanner({ mode, state: "error", message: "Timed out waiting for the scan to finish" });
      fetchDeadLetterTasks(token);
    } catch (err) {
      console.error("Scan failed", err);
      setBanner({ mode, state: "error", message: "Failed to start scan" });
    }
  }

  if (!ready || !token) {
    // Avoid a flash of dashboard chrome before we know whether there's a
    // session - the redirect effect above handles the no-token case.
    return (
      <div className="min-h-screen flex items-center justify-center">
        <RadarSweep size={120} />
      </div>
    );
  }

  const selectedReport = reports[selected];

  return (
    <div className="min-h-screen">
      <TopBar
        email={email}
        scanning={banner?.state === "running"}
        onScan={runScan}
        onSignOut={() => {
          signOut();
          router.replace("/login");
        }}
        onDeleteAccount={() => setShowDeleteModal(true)}
      />

      {showDeleteModal && token && (
        <DeleteAccountModal
          token={token}
          onClose={() => setShowDeleteModal(false)}
          onDeleted={() => {
            signOut();
            router.replace("/login");
          }}
        />
      )}

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {banner && (
          <div
            className={`rounded-xl border px-4 py-3 text-sm flex items-center gap-2 ${
              banner.state === "running"
                ? "border-signal/30 bg-signal/10 text-signal"
                : banner.state === "done"
                ? "border-good/30 bg-good/10 text-good"
                : "border-critical/30 bg-critical/10 text-critical"
            }`}
          >
            {banner.state === "running" && `Running ${banner.mode.toUpperCase()} scan…`}
            {banner.state === "done" && `${banner.mode.toUpperCase()} scan complete.`}
            {banner.state === "error" && `${banner.mode.toUpperCase()} scan failed: ${banner.message}`}
          </div>
        )}

        {!loadingReports && (
          <div className="grid lg:grid-cols-[1fr_260px] gap-6 items-start">
            {reports.length > 0 ? (
              <FindingsPanel report={selectedReport} token={token} />
            ) : (
              <EmptyState />
            )}
            <div className="space-y-6">
              <ConnectAwsAccount token={token} connections={connections} onChanged={() => fetchConnections(token)} />
              <ScheduleManager token={token} schedules={schedules} connections={connections} onChanged={() => fetchSchedules(token)} />
              <DeadLetterPanel
                token={token}
                tasks={deadLetterTasks}
                onDismissed={(taskId) =>
                  setDeadLetterTasks((prev) => prev.filter((t) => t.task_id !== taskId))
                }
              />
              <ScanHistory reports={reports} selected={selected} onSelect={setSelected} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
