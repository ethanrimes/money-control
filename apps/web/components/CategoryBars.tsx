"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, currentMonth, fmtUsd, type ByCategoryRow } from "@/lib/api";
import { Card } from "./Card";

export function CategoryBars({ refreshKey }: { refreshKey: number }) {
  const [month, setMonth] = useState<string>(currentMonth());
  const [data, setData] = useState<ByCategoryRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    api.byCategory(month).then((r) => setData(r.categories)).catch((e) => setErr(String(e)));
  }, [month, refreshKey]);

  return (
    <Card
      title="Spending by category"
      subtitle="Current month vs trailing 6-month average"
      action={
        <input
          type="month"
          className="rounded-md border border-border bg-bg px-2 py-1 text-xs"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
      }
    >
      {err && <div className="text-sm text-negative">{err}</div>}
      <div className="h-72 w-full">
        {data && (
          <ResponsiveContainer>
            <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 80 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
              <XAxis
                type="number"
                stroke="rgb(var(--muted))"
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`}
              />
              <YAxis
                type="category"
                dataKey="categoryName"
                stroke="rgb(var(--muted))"
                tick={{ fontSize: 11 }}
                width={120}
              />
              <Tooltip
                contentStyle={{
                  background: "rgb(var(--surface))",
                  border: "1px solid rgb(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value) => (typeof value === "number" ? fmtUsd(value) : String(value))}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="currentSpend" name="This month" fill="rgb(var(--accent))">
                {data.map((d, i) => (
                  <Cell key={i} fill={d.currentSpend > d.historicalAverage ? "rgb(var(--negative))" : "rgb(var(--accent))"} />
                ))}
              </Bar>
              <Bar dataKey="historicalAverage" name="Avg" fill="rgb(var(--muted))" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}
