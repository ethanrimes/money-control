"use client";

import { useEffect, useState } from "react";
import { api, fmtUsd, type NetCash } from "@/lib/api";
import { Card } from "./Card";

export function NetCashCard({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<NetCash | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.netCash().then(setData).catch((e) => setErr(String(e)));
  }, [refreshKey]);

  if (err) return <Card title="Net cash position"><div className="text-sm text-negative">{err}</div></Card>;
  if (!data) return <Card title="Net cash position"><div className="h-32 animate-pulse rounded bg-bg" /></Card>;

  const noBalances = data.perAccount.every((a) => a.balance === 0);

  return (
    <Card title="Net cash position" subtitle={noBalances ? "No live balances yet — link accounts via Refresh to populate." : undefined}>
      <div className={`text-3xl font-semibold tabular ${data.netCash >= 0 ? "text-text" : "text-negative"}`}>
        {fmtUsd(data.netCash)}
      </div>
      <div className="mt-1 text-xs text-muted">
        {fmtUsd(data.totalDepository)} cash · {fmtUsd(data.totalCredit)} debt
      </div>

      <ul className="mt-4 space-y-2 text-sm">
        {data.perAccount.map((a) => (
          <li key={a.accountId} className="flex items-center justify-between border-t border-border/50 pt-2">
            <span>
              {a.name}
              <span className="ml-2 text-xs text-muted">{a.type === "credit" ? "credit" : "depository"}</span>
            </span>
            <span className={`tabular ${a.type === "credit" ? "text-negative" : "text-text"}`}>
              {a.type === "credit" ? "−" : ""}{fmtUsd(a.balance)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
