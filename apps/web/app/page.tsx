"use client";

import { useState } from "react";
import { BudgetSettings } from "@/components/BudgetSettings";
import { CategoryBars } from "@/components/CategoryBars";
import { LinkedAccountsCard } from "@/components/LinkedAccountsCard";
import { RefreshButton } from "@/components/RefreshButton";
import { SpendSeriesChart } from "@/components/SpendSeriesChart";
import { StatsTiles } from "@/components/StatsTiles";
import { TransactionsTable } from "@/components/TransactionsTable";

export default function DashboardPage() {
  // refreshKey bumps every time data changes (manual refresh, budget edit,
  // transaction re-categorize). Children watch it as a useEffect dep.
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 lg:py-10">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">MoneyControl</h1>
          <p className="text-sm text-muted">Personal finance, end-to-end.</p>
        </div>
        <div className="flex items-center gap-4">
          <BudgetSettings onChange={bump} />
          <RefreshButton onSynced={bump} />
        </div>
      </header>

      <div className="space-y-6">
        <StatsTiles refreshKey={refreshKey} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <LinkedAccountsCard refreshKey={refreshKey} onChange={bump} />
          <div className="lg:col-span-2">
            <SpendSeriesChart refreshKey={refreshKey} />
          </div>
        </div>

        <CategoryBars refreshKey={refreshKey} />
        <TransactionsTable refreshKey={refreshKey} />
      </div>
    </main>
  );
}
