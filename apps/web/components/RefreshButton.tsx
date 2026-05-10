"use client";

import { useState } from "react";
import { api, type SyncResult } from "@/lib/api";

export function RefreshButton({ onSynced }: { onSynced: () => void }) {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<SyncResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.sync();
      setLast(r);
      onSynced();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  const linked = last?.enrollments.length ?? 0;

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
          {linked === 0
            ? "No accounts linked yet"
            : `Synced ${linked} institution${linked === 1 ? "" : "s"} · +${last.totals.transactions} txns`}
        </span>
      )}
      {err && <span className="text-xs text-negative">{err}</span>}
    </div>
  );
}
