"use client";

// Wraps react-plaid-link. Server creates the link_token; client opens Plaid
// Link; on success we post the public_token + metadata to /plaid/items which
// exchanges and persists the access_token.

import { useCallback, useEffect, useState } from "react";
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from "react-plaid-link";
import { api } from "@/lib/api";

export function PlaidLinkButton({ onLinked }: { onLinked: () => void }) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "success" | "error"; msg: string } | null>(null);

  // Bootstrap: fetch config; if configured, create a link_token on demand
  // (cheaper than pre-creating since tokens expire after 30 min).
  useEffect(() => {
    api.plaidConfig().then((c) => setConfigured(c.configured)).catch(() => setConfigured(false));
  }, []);

  const onSuccess = useCallback(async (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => {
    try {
      await api.plaidCreateItem(publicToken, {
        institution: metadata.institution ? {
          name: metadata.institution.name,
          institution_id: metadata.institution.institution_id,
        } : undefined,
      });
      setStatus({
        kind: "success",
        msg: `Linked ${metadata.institution?.name ?? "institution"}. Click Refresh to sync.`,
      });
      onLinked();
    } catch (e) {
      setStatus({ kind: "error", msg: String(e) });
    } finally {
      setBusy(false);
    }
  }, [onLinked]);

  // usePlaidLink wants linkToken from the start. If it's null we render a
  // disabled button that fetches a fresh token when clicked, then opens.
  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit: () => setBusy(false),
  });

  async function handleClick() {
    setStatus(null);
    setBusy(true);
    try {
      const t = await api.plaidLinkToken();
      setLinkToken(t.linkToken);
    } catch (e) {
      setStatus({ kind: "error", msg: String(e) });
      setBusy(false);
    }
  }

  // When the link_token lands, open Plaid Link automatically.
  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  const disabled = configured === false || busy;
  const title = configured === false
    ? "Plaid is not configured — set PLAID_CLIENT_ID and PLAID_SANDBOX_SECRET / PLAID_PRODUCTION_SECRET in .env"
    : "Link via Plaid (Amex deposits, Fidelity, full coverage)";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={handleClick}
        disabled={disabled}
        title={title}
        className="inline-flex items-center gap-2 rounded-md border border-accent bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:border-border disabled:bg-bg disabled:text-muted"
      >
        <span aria-hidden>+</span>
        {busy ? "Opening…" : "Link via Plaid"}
      </button>
      {status && (
        <span className={`text-xs ${status.kind === "success" ? "text-positive" : "text-negative"}`}>
          {status.msg}
        </span>
      )}
    </div>
  );
}
