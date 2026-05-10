"use client";

import { useEffect, useState } from "react";
import { api, type MonthlyDetail } from "@/lib/api";
import { MonthlyDetailTable } from "@/components/MonthlyDetailTable";

export default function BudgetPage() {
  const [data, setData] = useState<MonthlyDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.incomeDetail().then(setData).catch((e) => setErr(String(e)));
  }, []);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 lg:py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Budget</h1>
        <p className="mt-1 text-sm text-muted">
          Income per month from every source. The total below excludes the in-progress
          month so the average reflects whole months only.
        </p>
      </header>
      <MonthlyDetailTable data={data} unitLabel="income" errorText={err} />
    </main>
  );
}
