"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type CategoryNode, type MonthlyDetail } from "@/lib/api";
import { MonthlyDetailTable } from "@/components/MonthlyDetailTable";

export default function HistoricalAvgPage() {
  const [data, setData] = useState<MonthlyDetail | null>(null);
  const [cats, setCats] = useState<CategoryNode[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Controls
  const [throughDay, setThroughDay] = useState<number>(31);
  const [categoryId, setCategoryId] = useState<number | "all">("all");

  // Categories list (one-time fetch).
  useEffect(() => {
    api.categories().then(setCats).catch(() => {});
  }, []);

  // Refetch detail whenever a control changes.
  useEffect(() => {
    setData(null);
    api.spendDetail({
      throughDay,
      categoryId: categoryId === "all" ? null : categoryId,
    }).then(setData).catch((e) => setErr(String(e)));
  }, [throughDay, categoryId]);

  // Flat option list: top-level categories + their subcategories, all
  // selectable (server detects which scope to apply by reading parent_id).
  const catOptions = useMemo(() => {
    if (!cats) return [];
    const out: Array<{ id: number; label: string }> = [];
    for (const top of cats) {
      out.push({ id: top.id, label: top.name });
      for (const s of top.subcategories) {
        out.push({ id: s.id, label: `  ↳ ${top.name} / ${s.name}` });
      }
    }
    return out;
  }, [cats]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 lg:py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Historical avg</h1>
        <p className="mt-1 text-sm text-muted">
          Monthly spend by completed month. Use the controls to filter by
          (sub)category and to compare apples-to-apples by limiting each month
          to its first N days.
        </p>
      </header>

      <div className="mb-6 grid grid-cols-1 gap-4 rounded-xl border border-border bg-surface p-5 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-muted" htmlFor="hist-through-day">
            Through day of month
          </label>
          <div className="mt-2 flex items-center gap-3">
            <input
              id="hist-through-day"
              type="range"
              min={1}
              max={31}
              value={throughDay}
              onChange={(e) => setThroughDay(Number(e.target.value))}
              className="flex-1 accent-accent"
            />
            <span className="w-10 text-right text-sm tabular">{throughDay}</span>
          </div>
          <p className="mt-1 text-[11px] text-muted">
            Only transactions on or before day {throughDay} of each month are counted.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted" htmlFor="hist-cat">
            Category / subcategory
          </label>
          <select
            id="hist-cat"
            className="mt-2 w-full rounded-md border border-border bg-bg px-2 py-2 text-sm"
            value={categoryId === "all" ? "all" : String(categoryId)}
            onChange={(e) => {
              const v = e.target.value;
              setCategoryId(v === "all" ? "all" : Number(v));
            }}
          >
            <option value="all">Everything (all categories)</option>
            {catOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
      </div>

      <MonthlyDetailTable data={data} unitLabel="spend" summaryMode="average" errorText={err} />
    </main>
  );
}
