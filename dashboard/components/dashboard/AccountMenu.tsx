"use client";

import { useState } from "react";

export default function AccountMenu({
  email,
  onSignOut,
  onDeleteAccount,
}: {
  email: string | null;
  onSignOut: () => void;
  onDeleteAccount: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-slate hover:text-mist mono px-2 py-1.5 rounded-lg hover:bg-panel2 transition"
      >
        {email} <span className="text-slate/60">▾</span>
      </button>

      {open && (
        <>
          {/* click-outside catcher */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-48 rounded-lg border border-line bg-panel shadow-xl z-20 overflow-hidden">
            <button
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
              className="w-full text-left px-3.5 py-2.5 text-sm text-mist hover:bg-panel2 transition"
            >
              Sign out
            </button>
            <button
              onClick={() => {
                setOpen(false);
                onDeleteAccount();
              }}
              className="w-full text-left px-3.5 py-2.5 text-sm text-critical hover:bg-critical/10 transition border-t border-line"
            >
              Delete account
            </button>
          </div>
        </>
      )}
    </div>
  );
}
