"use client";

import { useState } from "react";
import { api } from "@/lib/api";

export function RefreshButton({ onSynced }: { onSynced: () => void }) {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<Awaited<ReturnType<typeof api.syncAll>> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.syncAll();
      setLast(r);
      onSynced();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  const newTxns = last?.totals.transactions ?? 0;

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={refresh}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:opacity-60"
        title="Pull latest data from Teller"
      >
        <span className={busy ? "animate-spin" : ""}>↻</span>
        {busy ? "Refreshing…" : "Refresh"}
      </button>
      {last && (
        <span className="text-xs text-muted">
          Synced · +{newTxns} txn{newTxns === 1 ? "" : "s"}
        </span>
      )}
      {err && <span className="text-xs text-negative">{err}</span>}
    </div>
  );
}
