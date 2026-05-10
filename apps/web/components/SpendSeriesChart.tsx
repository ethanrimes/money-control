"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, currentMonth, fmtUsd, type SpendSeries } from "@/lib/api";
import { Card } from "./Card";

export function SpendSeriesChart({ refreshKey }: { refreshKey: number }) {
  const [month, setMonth] = useState<string>(currentMonth());
  const [data, setData] = useState<SpendSeries | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    api.spendSeries(month).then(setData).catch((e) => setErr(String(e)));
  }, [month, refreshKey]);

  // Allow stepping back to past months for which we have history.
  const monthOptions = lastNMonths(12);

  return (
    <Card
      title="Spending vs budget"
      subtitle={data ? `Trailing income ${fmtUsd(data.trailingMonthlyIncome)} · savings target ${fmtUsd(data.monthlySavingsTarget)} · budget ${fmtUsd(data.monthlyBudget)}` : undefined}
      action={
        <select
          className="rounded-md border border-border bg-bg px-2 py-1 text-xs"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        >
          {monthOptions.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      }
    >
      {err && <div className="text-sm text-negative">{err}</div>}
      <div className="h-64 w-full">
        {data && (
          <ResponsiveContainer>
            <LineChart data={data.points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
              <XAxis dataKey="day" stroke="rgb(var(--muted))" tick={{ fontSize: 11 }} />
              <YAxis
                stroke="rgb(var(--muted))"
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`}
              />
              <Tooltip
                contentStyle={{
                  background: "rgb(var(--surface))",
                  border: "1px solid rgb(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value, name) => {
                  const n = typeof value === "number" ? value : null;
                  return [n == null ? "—" : fmtUsd(n), String(name)];
                }}
                labelFormatter={(d) => `Day ${d}`}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="actual" name="Actual MTD" stroke="rgb(var(--accent))" strokeWidth={2} dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="budget" name="Budget" stroke="rgb(var(--positive))" strokeWidth={1.5} strokeDasharray="6 4" dot={false} />
              <Line type="monotone" dataKey="historicalAvg" name="Historical avg" stroke="rgb(var(--muted))" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

function lastNMonths(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}
