"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import AuthCard from "@/components/auth/AuthCard";
import RadarSweep from "@/components/sentinel/RadarSweep";

export default function LoginPage() {
  const { token, ready } = useAuth();
  const router = useRouter();
  const [expiredNotice, setExpiredNotice] = useState(false);

  useEffect(() => {
    if (ready && token) router.replace("/");
  }, [ready, token, router]);

  useEffect(() => {
    if (sessionStorage.getItem("sentinel:signed-out-reason") === "expired") {
      setExpiredNotice(true);
      sessionStorage.removeItem("sentinel:signed-out-reason");
    }
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center overflow-hidden relative px-6 py-12">
      {/* ambient dot-grid field */}
      <div className="absolute inset-0 dot-grid opacity-40 pointer-events-none" />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at 30% 45%, rgba(63,199,192,0.08), transparent 55%)",
        }}
      />

      <div className="relative flex flex-col lg:flex-row items-center gap-16 max-w-4xl w-full">
        <div className="relative flex items-center justify-center lg:justify-start shrink-0">
          <RadarSweep size={280} />
          <div className="absolute max-w-[220px] text-left">
            <p className="text-xs uppercase tracking-[0.2em] text-signal mb-3">
              Cloud-Sentinel
            </p>
            <h1 className="display text-3xl font-bold text-mist leading-tight mb-3">
              Standing watch over your AWS perimeter.
            </h1>
            <p className="text-sm text-haze leading-relaxed">
              Sign in to run a scan and see exactly what&rsquo;s exposed.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4 items-stretch">
          {expiredNotice && (
            <div className="rounded-lg border border-medium/30 bg-medium/10 text-medium text-sm px-4 py-3 max-w-sm">
              Your session expired. Sign in again to continue.
            </div>
          )}
          <AuthCard />
        </div>
      </div>
    </main>
  );
}
