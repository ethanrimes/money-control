"use client";

// Excel-feel transactions table:
//   - Click a column header to sort by it (toggles asc/desc)
//   - Shift-click another column header to add it as a secondary sort key
//   - Top bar: free-text filter + per-column dropdowns (Account, Category)
//   - Each row's category dropdown PATCHes server-side. The server upserts
//     a categorization rule AND retro-applies it to other uncategorized rows
//     with the same normalized description, so labeling one transfer cascades.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, fmtUsd, type CategoryNode, type TransactionRow } from "@/lib/api";
import { Card } from "./Card";

type SortDir = "asc" | "desc";
type SortKey = { column: ColId; direction: SortDir };
type ColId = "date" | "description" | "account" | "category" | "amount";

const COLS: Array<{ id: ColId; label: string; align?: "left" | "right" }> = [
  { id: "date", label: "Date" },
  { id: "description", label: "Description" },
  { id: "account", label: "Account" },
  { id: "category", label: "Category" },
  { id: "amount", label: "Amount", align: "right" },
];

export function TransactionsTable({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<TransactionRow[] | null>(null);
  const [cats, setCats] = useState<CategoryNode[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [textFilter, setTextFilter] = useState("");
  const [accountFilter, setAccountFilter] = useState<number | "all" | "uncategorized">("all");
  const [categoryFilter, setCategoryFilter] = useState<number | "all" | "uncategorized">("all");
  type Period = "all" | "ytd" | "1m" | "3m" | "6m" | "custom";
  const [period, setPeriod] = useState<Period>("all");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [sortKeys, setSortKeys] = useState<SortKey[]>([{ column: "date", direction: "desc" }]);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Drag-fill state. While the user drags, `fillSource` is the row whose
  // category we'll propagate; `fillHoverIndex` is the bottom of the highlight
  // range (always in the currently-displayed sortedRows ordering). Both are
  // null when nothing is being dragged.
  const [fillSource, setFillSource] = useState<{ rowId: number; sourceIndex: number; value: string } | null>(null);
  const [fillHoverIndex, setFillHoverIndex] = useState<number | null>(null);

  useEffect(() => {
    setRows(null);
    Promise.all([api.transactions({ limit: 1000 }), api.categories()])
      .then(([t, c]) => { setRows(t); setCats(c); })
      .catch((e) => setErr(String(e)));
  }, [refreshKey]);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }

  // Distinct account list, derived from rows (avoids another fetch).
  const accountOptions = useMemo(() => {
    if (!rows) return [];
    const seen = new Map<number, string>();
    for (const r of rows) if (r.accountId && r.accountName) seen.set(r.accountId, r.accountName);
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  // Resolve the selected period to a [from, to] ISO-date window. "All" =
  // unbounded.
  const { fromIso, toIso } = useMemo(() => {
    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);
    const offsetMonths = (n: number): string => {
      const d = new Date(today);
      d.setMonth(d.getMonth() - n);
      return d.toISOString().slice(0, 10);
    };
    switch (period) {
      case "all": return { fromIso: null, toIso: null };
      case "ytd": return { fromIso: `${today.getFullYear()}-01-01`, toIso: todayIso };
      case "1m": return { fromIso: offsetMonths(1), toIso: todayIso };
      case "3m": return { fromIso: offsetMonths(3), toIso: todayIso };
      case "6m": return { fromIso: offsetMonths(6), toIso: todayIso };
      case "custom": return { fromIso: customFrom || null, toIso: customTo || null };
    }
  }, [period, customFrom, customTo]);

  // Filter → sort. All filters are client-side; we fetched up to 1000 rows
  // up front so changing a filter doesn't refetch.
  const filteredRows = useMemo(() => {
    if (!rows) return [];
    const q = textFilter.trim().toLowerCase();
    return rows.filter((r) => {
      if (q) {
        const hay = `${r.description} ${r.categoryName ?? ""} ${r.subcategoryName ?? ""} ${r.accountName ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (accountFilter !== "all" && r.accountId !== accountFilter) return false;
      if (categoryFilter === "uncategorized") {
        if (r.categoryId !== null) return false;
      } else if (categoryFilter !== "all") {
        if (r.categoryId !== categoryFilter && r.subcategoryId !== categoryFilter) return false;
      }
      if (fromIso && r.date < fromIso) return false;
      if (toIso && r.date > toIso) return false;
      return true;
    });
  }, [rows, textFilter, accountFilter, categoryFilter, fromIso, toIso]);

  const sortedRows = useMemo(() => {
    const cmp = (a: TransactionRow, b: TransactionRow): number => {
      for (const key of sortKeys) {
        const c = compareCol(a, b, key.column) * (key.direction === "asc" ? 1 : -1);
        if (c !== 0) return c;
      }
      return 0;
    };
    return [...filteredRows].sort(cmp);
  }, [filteredRows, sortKeys]);

  function onHeaderClick(col: ColId, ev: React.MouseEvent) {
    const shift = ev.shiftKey;
    setSortKeys((prev) => {
      const existing = prev.find((k) => k.column === col);
      if (shift) {
        if (existing) {
          return prev.map((k) => k.column === col ? { ...k, direction: flip(k.direction) } : k);
        }
        return [...prev, { column: col, direction: "asc" }];
      }
      return [{ column: col, direction: existing ? flip(existing.direction) : "asc" }];
    });
  }

  // Flat option list with parent-prefixed subcategory labels, used by every
  // row's category dropdown AND the filter dropdown at the top.
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

  // Drag-fill mechanics. The handle is rendered absolutely at the bottom-right
  // of every category cell. mousedown on it captures the source row + value;
  // mouseover on other rows' category cells extends the range; mouseup
  // applies via the bulk PATCH endpoint.
  function startDragFill(rowId: number, value: string, sourceIndex: number) {
    setFillSource({ rowId, sourceIndex, value });
    setFillHoverIndex(sourceIndex);
  }

  const endDragFill = useCallback(async () => {
    if (!fillSource || fillHoverIndex === null) {
      setFillSource(null);
      setFillHoverIndex(null);
      return;
    }
    const top = Math.min(fillSource.sourceIndex, fillHoverIndex);
    const bot = Math.max(fillSource.sourceIndex, fillHoverIndex);
    // Exclude the source row itself — its category is already correct.
    const targetIds = sortedRows.slice(top, bot + 1).map((r) => r.id).filter((id) => id !== fillSource.rowId);
    setFillSource(null);
    setFillHoverIndex(null);
    if (targetIds.length === 0) return;

    // Resolve the destination category from the source value.
    let categoryId: number | null = null;
    let subcategoryId: number | null = null;
    if (fillSource.value !== "") {
      const id = Number(fillSource.value);
      const opt = catOptions.find((o) => o.id === id);
      if (!opt) return;
      categoryId = opt.parentId ?? id;
      subcategoryId = opt.parentId === null ? null : id;
    }
    try {
      const res = await api.bulkPatchTransactions({ ids: targetIds, categoryId, subcategoryId });
      const total = res.updated + res.backfillCount;
      showToast(`Drag-filled ${res.updated} row${res.updated === 1 ? "" : "s"}${res.backfillCount > 0 ? ` + auto-applied to ${res.backfillCount} more` : ""}.`);
      void total;
      const fresh = await api.transactions({ limit: 1000 });
      setRows(fresh);
    } catch (e) {
      alert(`Drag-fill failed: ${e}`);
    }
  }, [fillSource, fillHoverIndex, sortedRows, catOptions]);

  // While a drag is active, listen for mousemove on the WINDOW (not on each
  // <td>). During a mouse drag the browser captures pointer events to the
  // element that received the original mousedown, so onMouseEnter on other
  // cells doesn't fire. Hit-test with document.elementFromPoint instead.
  useEffect(() => {
    if (!fillSource) return;
    const onMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const tr = el?.closest("tr[data-row-index]") as HTMLElement | null;
      if (!tr) return;
      const idx = Number(tr.getAttribute("data-row-index"));
      if (Number.isFinite(idx)) setFillHoverIndex(idx);
    };
    const onUp = () => { void endDragFill(); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [fillSource, endDragFill]);

  async function saveCategory(txId: number, value: string) {
    if (!cats) return;
    setSavingId(txId);
    try {
      let res;
      if (value === "") {
        res = await api.patchTransaction(txId, { categoryId: null, subcategoryId: null });
      } else {
        const id = Number(value);
        const opt = catOptions.find((o) => o.id === id);
        if (!opt) return;
        res = await api.patchTransaction(txId, {
          categoryId: opt.parentId ?? id,
          subcategoryId: opt.parentId === null ? null : id,
        });
      }
      if (res.backfillCount > 0) {
        showToast(`Categorized + auto-applied to ${res.backfillCount} matching transaction${res.backfillCount === 1 ? "" : "s"}.`);
      }
      // Refresh — backfill may have updated many rows.
      const fresh = await api.transactions({ limit: 1000 });
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
      subtitle={rows ? `${sortedRows.length} of ${rows.length} shown` : undefined}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <input
            placeholder="Search…"
            className="w-40 rounded-md border border-border bg-bg px-2 py-1 text-xs"
            value={textFilter}
            onChange={(e) => setTextFilter(e.target.value)}
          />
          <select
            className="rounded-md border border-border bg-bg px-2 py-1 text-xs"
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            title="Filter by time period"
          >
            <option value="all">All time</option>
            <option value="ytd">Year to date</option>
            <option value="1m">Past month</option>
            <option value="3m">Past 3 months</option>
            <option value="6m">Past 6 months</option>
            <option value="custom">Custom range…</option>
          </select>
          {period === "custom" && (
            <>
              <input
                type="date"
                className="rounded-md border border-border bg-bg px-2 py-1 text-xs"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                title="From"
              />
              <span className="text-xs text-muted">→</span>
              <input
                type="date"
                className="rounded-md border border-border bg-bg px-2 py-1 text-xs"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                title="To"
              />
            </>
          )}
          <select
            className="rounded-md border border-border bg-bg px-2 py-1 text-xs"
            value={accountFilter === "all" ? "all" : String(accountFilter)}
            onChange={(e) => {
              const v = e.target.value;
              setAccountFilter(v === "all" ? "all" : Number(v));
            }}
            title="Filter by account"
          >
            <option value="all">All accounts</option>
            {accountOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select
            className="rounded-md border border-border bg-bg px-2 py-1 text-xs"
            value={typeof categoryFilter === "number" ? String(categoryFilter) : categoryFilter}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "all" || v === "uncategorized") setCategoryFilter(v);
              else setCategoryFilter(Number(v));
            }}
            title="Filter by category or subcategory"
          >
            <option value="all">All categories</option>
            <option value="uncategorized">— Uncategorized —</option>
            {catOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
      }
    >
      {err && <div className="text-sm text-negative">{err}</div>}
      {!rows && <div className="h-40 animate-pulse rounded bg-bg" />}

      {rows && (
        <>
          {toast && (
            <div className="mb-2 rounded-md border border-positive/30 bg-positive/10 px-3 py-2 text-xs text-positive">
              {toast}
            </div>
          )}
          <div className="text-[11px] text-muted/80 mb-2">
            Click a column header to sort. Shift-click to add a secondary sort.
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  {COLS.map((col) => {
                    const idx = sortKeys.findIndex((k) => k.column === col.id);
                    const key = idx >= 0 ? sortKeys[idx]! : null;
                    return (
                      <th
                        key={col.id}
                        onClick={(e) => onHeaderClick(col.id, e)}
                        className={`cursor-pointer select-none border-b border-border py-2 pr-4 font-medium hover:text-text ${col.align === "right" ? "text-right" : ""}`}
                        title="Click to sort, shift-click to add"
                      >
                        <span className="inline-flex items-center gap-1">
                          {col.label}
                          {key && (
                            <span className="text-accent">
                              {key.direction === "asc" ? "↑" : "↓"}
                              {sortKeys.length > 1 && <sub className="ml-0.5 text-[9px]">{idx + 1}</sub>}
                            </span>
                          )}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r, rowIndex) => {
                  const inFillRange = fillSource !== null && fillHoverIndex !== null
                    && rowIndex >= Math.min(fillSource.sourceIndex, fillHoverIndex)
                    && rowIndex <= Math.max(fillSource.sourceIndex, fillHoverIndex);
                  const fillValue = fillSource?.value ?? "";
                  const previewLabel = inFillRange && r.id !== fillSource?.rowId
                    ? (fillValue === "" ? "— uncategorized —" : catOptions.find((o) => o.id === Number(fillValue))?.label ?? "")
                    : null;
                  return (
                    <tr
                      key={r.id}
                      data-row-index={rowIndex}
                      className={`hover:bg-bg/60 ${inFillRange ? "bg-accent/5" : ""}`}
                    >
                      <td className="border-b border-border/50 py-2 pr-4 text-muted tabular">{r.date}</td>
                      <td className="border-b border-border/50 py-2 pr-4">
                        {r.description}
                        {r.source !== "excel" && (
                          <span className="ml-2 rounded bg-bg px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">{r.source}</span>
                        )}
                      </td>
                      <td className="border-b border-border/50 py-2 pr-4 text-muted">{r.accountName}</td>
                      <td className="border-b border-border/50 py-2 pr-4">
                        <div className="relative inline-block">
                          <select
                            className={`w-56 max-w-full rounded border border-border bg-bg px-1.5 py-1 pr-4 text-xs ${previewLabel ? "ring-1 ring-accent/60" : ""}`}
                            value={previewLabel
                              ? (fillValue === "" ? "" : Number(fillValue))
                              : (r.subcategoryId ?? r.categoryId ?? "")}
                            disabled={savingId === r.id || fillSource !== null}
                            onChange={(e) => saveCategory(r.id, e.target.value)}
                          >
                            <option value="">— uncategorized —</option>
                            {catOptions.map((o) => (
                              <option key={o.id} value={o.id}>{o.label}</option>
                            ))}
                          </select>
                          {/* Fill handle: always-visible blue square at the
                              bottom-right corner of the select. Click + drag
                              down propagates this row's category to the rows
                              below. Sized + positioned to be discoverable. */}
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              startDragFill(r.id, String(r.subcategoryId ?? r.categoryId ?? ""), rowIndex);
                            }}
                            title="Drag down to copy this category to the rows below"
                            className="absolute -bottom-1 -right-1 z-10 h-3 w-3 cursor-row-resize rounded-sm border border-white/40 bg-accent shadow hover:scale-125"
                            aria-label="Drag-fill category"
                          />
                        </div>
                      </td>
                      <td className={`border-b border-border/50 py-2 pr-2 text-right tabular ${r.amount < 0 ? "text-negative" : "text-positive"}`}>
                        {fmtUsd(r.amount, { sign: r.amount > 0 })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

function flip(d: SortDir): SortDir {
  return d === "asc" ? "desc" : "asc";
}

// Pulls a sortable scalar out of a transaction for a given column. nulls
// always sort to the bottom regardless of direction (consistent with most
// spreadsheets).
function compareCol(a: TransactionRow, b: TransactionRow, col: ColId): number {
  const va = readColumn(a, col);
  const vb = readColumn(b, col);
  if (va == null && vb == null) return 0;
  if (va == null) return 1;
  if (vb == null) return -1;
  if (typeof va === "number" && typeof vb === "number") return va - vb;
  return String(va).localeCompare(String(vb));
}

function readColumn(r: TransactionRow, col: ColId): string | number | null {
  switch (col) {
    case "date": return r.date;
    case "description": return r.description;
    case "account": return r.accountName;
    case "category": return r.subcategoryName ?? r.categoryName;
    case "amount": return r.amount;
  }
}
