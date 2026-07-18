"use client";

import { useState } from "react";
import { deleteAccount } from "@/lib/api";
import Button from "@/components/ui/Button";

export default function DeleteAccountModal({
  token,
  onClose,
  onDeleted,
}: {
  token: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(token, password);
      onDeleted();
    } catch (err: any) {
      const msg = String(err?.message || "");
      setError(msg.includes("invalid credentials") ? "Wrong password." : "Couldn't delete your account. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl2 border border-critical/30 bg-panel p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="display text-lg font-bold text-mist mb-2">Delete account</h2>
        <p className="text-sm text-haze mb-4">
          This permanently deletes your account and every scan report you have. This
          can&rsquo;t be undone.
        </p>

        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Confirm your password"
          className="w-full rounded-lg bg-panel2 border border-grid px-3 py-2.5 text-sm text-mist placeholder:text-haze/60 focus:border-critical outline-none transition mb-3"
        />

        {error && <p className="text-sm text-critical mb-3">{error}</p>}

        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete} disabled={busy || !password}>
            {busy ? "Deleting…" : "Delete permanently"}
          </Button>
        </div>
      </div>
    </div>
  );
}
