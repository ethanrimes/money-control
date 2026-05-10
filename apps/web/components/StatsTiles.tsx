"use client";

import { useEffect, useState } from "react";
import { api, fmtUsd, type Stats } from "@/lib/api";

export function StatsTiles({ refreshKey }: { refreshKey: number }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.stats().then(setStats).catch((e) => setErr(String(e)));
  }, [refreshKey]);

  if (err) return <div className="text-sm text-negative">Failed to load stats: {err}</div>;
  if (!stats) return <div className="grid grid-cols-3 gap-4">{[0, 1, 2].map((i) => <Skeleton key={i} />)}</div>;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Tile label="MTD spend" value={fmtUsd(-stats.mtdSpend)} valueClass="text-negative" />
      <Tile label="MTD income" value={fmtUsd(stats.mtdIncome, { sign: true })} valueClass="text-positive" />
      <Tile label="MTD transactions" value={String(stats.mtdTransactionCount)} />
    </div>
  );
}

function Tile({ label, value, valueClass = "" }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular ${valueClass}`}>{value}</div>
    </div>
  );
}

function Skeleton() {
  return <div className="h-20 animate-pulse rounded-xl border border-border bg-surface" />;
}
