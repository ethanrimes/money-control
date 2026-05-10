"use client";

// Shared component for the Budget tab (income detail) and Historical Avg tab
// (spend detail). Renders:
//   - Top summary row: total + average over N completed months
//   - One row per month with an expand/collapse chevron
//   - When expanded (default = all expanded): per-transaction list inside
//
// "Completed" months get a normal display; the in-progress current month is
// labeled as such and excluded from the rolling total.

import { useEffect, useMemo, useState } from "react";
import { fmtUsd, type MonthlyDetail } from "@/lib/api";

export function MonthlyDetailTable({
  data,
  unitLabel,
  summaryMode = "total",
  errorText,
}: {
  data: MonthlyDetail | null;
  unitLabel: string;        // e.g. "income" or "spend"
  summaryMode?: "total" | "average"; // which metric is the headline number
  errorText?: string | null;
}) {
  const allKeys = useMemo(() => new Set(data?.months.map((m) => m.month) ?? []), [data]);
  const [expanded, setExpanded] = useState<Set<string>>(allKeys);

  // When the data first loads (or refreshes with a new shape), default to
  // all months expanded.
  useEffect(() => { setExpanded(new Set(data?.months.map((m) => m.month) ?? [])); }, [data]);

  function toggle(month: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });
  }

  if (errorText) {
    return <div className="rounded-lg border border-negative/40 bg-negative/5 px-4 py-3 text-sm text-negative">{errorText}</div>;
  }
  if (!data) {
    return <div className="h-64 animate-pulse rounded-lg border border-border bg-surface" />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-bg/60 text-left text-xs text-muted">
            <th className="px-4 py-3 font-medium" colSpan={2}>Month</th>
            <th className="px-4 py-3 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {/* Overall summary row. Headline number is either total or average
              depending on summaryMode; the other metric appears in the
              subtitle. */}
          <tr className="border-t border-border bg-bg/30">
            <td className="px-4 py-3" colSpan={2}>
              <div className="font-medium">
                {summaryMode === "average" ? "Average per month" : "All completed months"}
              </div>
              <div className="text-xs text-muted">
                {data.completedMonthCount} completed month{data.completedMonthCount === 1 ? "" : "s"}
                {data.completedMonthCount > 0 && (
                  summaryMode === "average"
                    ? <> · total <span className="tabular">{fmtUsd(data.totalOverCompletedMonths)}</span></>
                    : <> · avg <span className="tabular">{fmtUsd(data.averageOverCompletedMonths)}</span> per month</>
                )}
              </div>
            </td>
            <td className="px-4 py-3 text-right text-lg font-semibold tabular">
              {fmtUsd(summaryMode === "average" ? data.averageOverCompletedMonths : data.totalOverCompletedMonths)}
            </td>
          </tr>
          {data.months.map((m) => {
            const isOpen = expanded.has(m.month);
            return (
              <MonthBlock
                key={m.month}
                month={m}
                isOpen={isOpen}
                onToggle={() => toggle(m.month)}
                unitLabel={unitLabel}
              />
            );
          })}
          {data.months.length === 0 && (
            <tr>
              <td className="px-4 py-6 text-center text-sm text-muted" colSpan={3}>
                No {unitLabel} transactions found yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function MonthBlock({
  month,
  isOpen,
  onToggle,
  unitLabel,
}: {
  month: MonthlyDetail["months"][number];
  isOpen: boolean;
  onToggle: () => void;
  unitLabel: string;
}) {
  return (
    <>
      <tr className="cursor-pointer border-t border-border hover:bg-bg/40" onClick={onToggle}>
        <td className="w-8 px-4 py-3 text-muted">
          <span className={`inline-block transition ${isOpen ? "rotate-90" : ""}`}>▶</span>
        </td>
        <td className="px-4 py-3">
          <div className="font-medium">{formatMonth(month.month)}</div>
          <div className="text-xs text-muted">
            {month.transactions.length} {unitLabel} transaction{month.transactions.length === 1 ? "" : "s"}
            {!month.isComplete && <span className="ml-2 rounded bg-bg px-1.5 py-0.5 text-[10px] uppercase tracking-wide">in progress</span>}
          </div>
        </td>
        <td className={`px-4 py-3 text-right tabular ${month.isComplete ? "font-semibold" : "text-muted"}`}>
          {fmtUsd(month.total)}
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td className="px-4 pb-4 pt-0" colSpan={3}>
            <table className="ml-8 w-[calc(100%-2rem)] border-collapse text-xs">
              <thead>
                <tr className="text-left text-muted">
                  <th className="border-b border-border/60 py-1.5 pr-3 font-normal">Date</th>
                  <th className="border-b border-border/60 py-1.5 pr-3 font-normal">Description</th>
                  <th className="border-b border-border/60 py-1.5 pr-3 font-normal">Account</th>
                  <th className="border-b border-border/60 py-1.5 pr-3 font-normal">Category</th>
                  <th className="border-b border-border/60 py-1.5 pr-3 text-right font-normal">Amount</th>
                </tr>
              </thead>
              <tbody>
                {month.transactions.map((t) => (
                  <tr key={t.id} className="hover:bg-bg/40">
                    <td className="border-b border-border/30 py-1.5 pr-3 tabular text-muted">{t.date}</td>
                    <td className="border-b border-border/30 py-1.5 pr-3">{t.description}</td>
                    <td className="border-b border-border/30 py-1.5 pr-3 text-muted">{t.accountName ?? "—"}</td>
                    <td className="border-b border-border/30 py-1.5 pr-3 text-muted">
                      {t.subcategoryName ?? t.categoryName ?? "(uncategorized)"}
                    </td>
                    <td className="border-b border-border/30 py-1.5 pr-3 text-right tabular">
                      {fmtUsd(Math.abs(t.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

function formatMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split("-");
  if (!y || !m) return yyyymm;
  const monthName = new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", { month: "long" });
  return `${monthName} ${y}`;
}
