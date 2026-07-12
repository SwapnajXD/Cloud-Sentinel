"use client";

import { FormEvent, useState } from "react";
import { useAuth } from "@/lib/auth-context";

type Mode = "signin" | "signup";

export default function AuthCard() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "signin") {
        await signIn(email, password);
      } else {
        await signUp(email, password);
      }
    } catch (err: any) {
      setError(readableError(err?.message, mode));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-sm rounded-xl2 border border-line bg-panel/90 backdrop-blur-sm p-7 shadow-2xl shadow-black/40">
      <div className="flex mb-6 rounded-lg bg-panel2 p-1 text-sm">
        <button
          type="button"
          onClick={() => { setMode("signin"); setError(null); }}
          className={`flex-1 py-2 rounded-md transition font-medium ${
            mode === "signin" ? "bg-brass text-ink" : "text-slate hover:text-mist"
          }`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => { setMode("signup"); setError(null); }}
          className={`flex-1 py-2 rounded-md transition font-medium ${
            mode === "signup" ? "bg-brass text-ink" : "text-slate hover:text-mist"
          }`}
        >
          Create account
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-xs font-medium text-slate mb-1.5">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="w-full rounded-lg bg-panel2 border border-line px-3 py-2.5 text-sm text-mist placeholder:text-slate/60 focus:border-brass outline-none transition"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-xs font-medium text-slate mb-1.5">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            className="w-full rounded-lg bg-panel2 border border-line px-3 py-2.5 text-sm text-mist placeholder:text-slate/60 focus:border-brass outline-none transition"
          />
        </div>

        {error && (
          <p className="text-sm text-critical bg-critical/10 border border-critical/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-brass text-ink font-medium py-2.5 text-sm hover:brightness-110 disabled:brightness-75 disabled:cursor-not-allowed transition"
        >
          {busy
            ? mode === "signin" ? "Signing in…" : "Creating account…"
            : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>
    </div>
  );
}

function readableError(message: string | undefined, mode: Mode): string {
  if (!message) return "Something went wrong. Try again.";
  if (message.includes("invalid credentials")) return "Wrong email or password.";
  if (message.includes("email exists")) return "That email is already registered — try signing in instead.";
  if (message.includes("invalid email format")) return "That doesn't look like a valid email.";
  if (message.includes("weak password")) return "Password needs to be at least 8 characters.";
  if (message.includes("too many attempts")) return "Too many attempts. Wait a few minutes and try again.";
  return mode === "signin" ? "Couldn't sign in. Check your details and try again." : "Couldn't create your account. Try again.";
}
