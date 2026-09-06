"use client";

import { useState } from "react";
import { createAwsConnection, deleteAwsConnection, AwsConnection } from "@/lib/api";
import Button from "@/components/ui/Button";

const TEMPLATE_URL = process.env.NEXT_PUBLIC_CFN_TEMPLATE_URL || "";
const TRUSTED_PRINCIPAL_ARN = process.env.NEXT_PUBLIC_TRUSTED_PRINCIPAL_ARN || "";
const CONFIGURED = Boolean(TEMPLATE_URL && TRUSTED_PRINCIPAL_ARN);

function buildQuicklink(externalId: string): string {
  const params = new URLSearchParams({
    templateURL: TEMPLATE_URL,
    stackName: "CloudSentinelScanRole",
    param_TrustedPrincipalArn: TRUSTED_PRINCIPAL_ARN,
    param_ExternalId: externalId,
  });
  return `https://console.aws.amazon.com/cloudformation/home#/stacks/create/review?${params.toString()}`;
}

export default function ConnectAwsAccount({
  token,
  connections,
  onChanged,
}: {
  token: string;
  connections: AwsConnection[];
  onChanged: () => void;
}) {
  const [externalId, setExternalId] = useState<string | null>(null);
  const [roleArn, setRoleArn] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startConnecting() {
    setExternalId(crypto.randomUUID());
    setRoleArn("");
    setLabel("");
    setError(null);
  }

  async function handleSave() {
    if (!externalId) return;
    setBusy(true);
    setError(null);
    try {
      await createAwsConnection(token, {
        role_arn: roleArn.trim(),
        external_id: externalId,
        label: label.trim() || undefined,
      });
      setExternalId(null);
      onChanged();
    } catch (err: any) {
      const msg = String(err?.message || "");
      setError(
        msg.includes("valid IAM role ARN")
          ? "That doesn't look like a valid Role ARN."
          : "Couldn't save this connection."
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteAwsConnection(token, id);
      onChanged();
    } catch (err) {
      console.error("Failed to delete connection", err);
    }
  }

  return (
    <div className="rounded-xl2 border border-grid bg-panel p-4">
      <p className="text-xs uppercase tracking-wider text-haze font-medium mb-3 px-1">
        AWS accounts
      </p>

      {connections.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {connections.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-2 rounded-lg bg-panel2 border border-grid px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="text-mist truncate">{c.label || "Connected account"}</p>
                <p className="text-haze text-xs mono truncate">{c.role_arn}</p>
              </div>
              <button
                onClick={() => handleDelete(c.id)}
                className="text-haze hover:text-critical transition shrink-0"
                aria-label="Disconnect"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {!CONFIGURED && (
        <p className="text-sm text-medium leading-relaxed mb-1">
          Cross-account connections aren&rsquo;t configured on this deployment
          yet (missing <span className="mono text-xs">NEXT_PUBLIC_CFN_TEMPLATE_URL</span> /{" "}
          <span className="mono text-xs">NEXT_PUBLIC_TRUSTED_PRINCIPAL_ARN</span>). Scans will
          use this server&rsquo;s existing static AWS credentials instead.
        </p>
      )}

      {CONFIGURED && externalId === null && (
        <Button variant="secondary" onClick={startConnecting} className="w-full">
          Connect AWS account
        </Button>
      )}

      {CONFIGURED && externalId !== null && (
        <div className="space-y-2.5">
          <ol className="text-sm text-haze leading-relaxed list-decimal list-inside space-y-1">
            <li>
              <a
                href={buildQuicklink(externalId)}
                target="_blank"
                rel="noreferrer"
                className="text-signal underline"
              >
                Launch the setup stack
              </a>{" "}
              in the AWS account you want to connect.
            </li>
            <li>
              Copy the <span className="mono text-mist">RoleArn</span> from the
              stack&rsquo;s Outputs tab.
            </li>
            <li>Paste it below.</li>
          </ol>
          <input
            value={roleArn}
            onChange={(e) => setRoleArn(e.target.value)}
            placeholder="arn:aws:iam::123456789012:role/CloudSentinelScanRole"
            className="w-full rounded-lg bg-panel2 border border-grid px-3 py-2 text-sm mono text-mist placeholder:text-haze/60 focus:border-signal outline-none transition"
          />
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder='Label (optional, e.g. "prod")'
            className="w-full rounded-lg bg-panel2 border border-grid px-3 py-2 text-sm text-mist placeholder:text-haze/60 focus:border-signal outline-none transition"
          />
          {error && <p className="text-sm text-critical">{error}</p>}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setExternalId(null)}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={handleSave}
              disabled={busy || !roleArn.trim()}
              className="flex-1"
            >
              {busy ? "Saving…" : "Save connection"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
