"use client";

import { useEffect, useMemo, useState } from "react";
import { api, fmtUsd, type CategoryNode, type TransactionRow } from "@/lib/api";
import { Card } from "./Card";

export function TransactionsTable({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<TransactionRow[] | null>(null);
  const [cats, setCats] = useState<CategoryNode[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [savingId, setSavingId] = useState<number | null>(null);

  useEffect(() => {
    setRows(null);
    Promise.all([api.transactions({ limit: 200 }), api.categories()])
      .then(([t, c]) => { setRows(t); setCats(c); })
      .catch((e) => setErr(String(e)));
  }, [refreshKey]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.description.toLowerCase().includes(q) ||
      (r.categoryName ?? "").toLowerCase().includes(q) ||
      (r.subcategoryName ?? "").toLowerCase().includes(q) ||
      (r.accountName ?? "").toLowerCase().includes(q),
    );
  }, [rows, filter]);

  // Build {top-level + subcat} flat options for the dropdown, prefixed by parent.
  const catOptions = useMemo(() => {
    if (!cats) return [];
    const out: Array<{ id: number; label: string; parentId: number | null }> = [];
    for (const top of cats) {
      out.push({ id: top.id, label: top.name, parentId: null });
      for (const s of top.subcategories) {
        out.push({ id: s.id, label: `  ↳ ${top.name} / ${s.name}`, parentId: top.id });
      }
    }
    return out;
  }, [cats]);

  async function saveCategory(txId: number, value: string) {
    if (!cats) return;
    setSavingId(txId);
    try {
      if (value === "") {
        await api.patchTransaction(txId, { categoryId: null, subcategoryId: null });
      } else {
        const id = Number(value);
        const opt = catOptions.find((o) => o.id === id);
        if (!opt) return;
        await api.patchTransaction(txId, {
          categoryId: opt.parentId ?? id,
          subcategoryId: opt.parentId === null ? null : id,
        });
      }
      // Refresh just this row.
      const fresh = await api.transactions({ limit: 200 });
      setRows(fresh);
    } catch (e) {
      alert(`Failed to save: ${e}`);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <Card
      title="Transactions"
      subtitle={rows ? `${filtered.length} of ${rows.length} shown` : undefined}
      action={
        <input
          placeholder="Filter…"
          className="w-48 rounded-md border border-border bg-bg px-2 py-1 text-xs"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      }
    >
      {err && <div className="text-sm text-negative">{err}</div>}
      {!rows && <div className="h-40 animate-pulse rounded bg-bg" />}
      {rows && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="border-b border-border py-2 pr-4 font-medium">Date</th>
                <th className="border-b border-border py-2 pr-4 font-medium">Description</th>
                <th className="border-b border-border py-2 pr-4 font-medium">Account</th>
                <th className="border-b border-border py-2 pr-4 font-medium">Category</th>
                <th className="border-b border-border py-2 pr-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-bg/60">
                  <td className="border-b border-border/50 py-2 pr-4 text-muted tabular">{r.date}</td>
                  <td className="border-b border-border/50 py-2 pr-4">
                    {r.description}
                    {r.source !== "excel" && (
                      <span className="ml-2 rounded bg-bg px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">{r.source}</span>
                    )}
                  </td>
                  <td className="border-b border-border/50 py-2 pr-4 text-muted">{r.accountName}</td>
                  <td className="border-b border-border/50 py-2 pr-4">
                    <select
                      className="w-56 max-w-full rounded border border-border bg-bg px-1.5 py-1 text-xs"
                      value={r.subcategoryId ?? r.categoryId ?? ""}
                      disabled={savingId === r.id}
                      onChange={(e) => saveCategory(r.id, e.target.value)}
                    >
                      <option value="">— uncategorized —</option>
                      {catOptions.map((o) => (
                        <option key={o.id} value={o.id}>{o.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className={`border-b border-border/50 py-2 pr-2 text-right tabular ${r.amount < 0 ? "text-negative" : "text-positive"}`}>
                    {fmtUsd(r.amount, { sign: r.amount > 0 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
