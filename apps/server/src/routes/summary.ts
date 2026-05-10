import { Hono } from "hono";
import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { getDb } from "@moneycontrol/db";
import { accounts, balances, budgetSettings, categories, transactions } from "@moneycontrol/db/schema";
import { computeMonthlyBudget, daysInMonth, buildSpendSeries } from "@moneycontrol/core";

export const summaryRoutes = new Hono();

// Net cash position: sum of latest depository balances minus sum of latest
// credit balances (credit balances are stored as positive = amount owed).
summaryRoutes.get("/net-cash", async (c) => {
  const db = getDb();

  const accts = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      latestBalance: sql<number | null>`(
        SELECT current FROM ${balances}
        WHERE ${balances.accountId} = ${accounts.id}
        ORDER BY ${balances.asOfDate} DESC LIMIT 1
      )`,
    })
    .from(accounts);

  let totalDepository = 0;
  let totalCredit = 0;
  const perAccount = accts.map((a) => {
    const bal = a.latestBalance ?? 0;
    if (a.type === "depository") totalDepository += bal;
    else totalCredit += bal;
    return { accountId: a.id, name: a.name, type: a.type, balance: bal };
  });

  return c.json({
    totalDepository,
    totalCredit,
    netCash: totalDepository - totalCredit,
    perAccount,
  });
});

// Month-to-date cumulative spend with budget + historical-average reference lines.
//   ?month=YYYY-MM (default = current calendar month)
//   ?historyMonths=N (default 6) — months of past data to average for the trend line
summaryRoutes.get("/spend-series", async (c) => {
  const q = c.req.query();
  const today = new Date();
  const monthArg = q.month ?? `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}`;
  const m = monthArg.match(/^(\d{4})-(\d{2})$/);
  if (!m) return c.json({ error: "month must be YYYY-MM" }, 400);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const historyMonths = Math.max(1, Math.min(24, Number(q.historyMonths ?? 6)));

  const db = getDb();
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const total = daysInMonth(year, month);
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(total).padStart(2, "0")}`;
  const todayDay = (today.getUTCFullYear() === year && today.getUTCMonth() + 1 === month)
    ? today.getUTCDate()
    : total;

  // Current-month outflows. We treat any negative-amount transaction as spend.
  const monthTxns = await db
    .select({ date: transactions.date, amount: transactions.amount })
    .from(transactions)
    .where(and(gte(transactions.date, monthStart), lte(transactions.date, monthEnd)));

  // Trailing N months: per-day cumulative spend, averaged across months.
  const histStart = isoMonthOffset(year, month, -historyMonths);
  const histEnd = isoMonthOffset(year, month, -1, true);
  const histRows = await db
    .select({
      date: transactions.date,
      amount: transactions.amount,
    })
    .from(transactions)
    .where(and(gte(transactions.date, histStart), lte(transactions.date, histEnd)));

  // Build day-of-month -> sum of cum outflow per month, then average.
  const byMonthDay: Record<string, number[]> = {}; // 'YYYY-MM' -> [day1cum, day2cum, ...]
  for (const r of histRows) {
    if (r.amount >= 0) continue;
    const key = r.date.slice(0, 7);
    const day = Number(r.date.slice(8, 10));
    if (!byMonthDay[key]) byMonthDay[key] = new Array(31).fill(0);
    byMonthDay[key]![day - 1] += -r.amount;
  }
  for (const key of Object.keys(byMonthDay)) {
    const arr = byMonthDay[key]!;
    for (let i = 1; i < arr.length; i++) arr[i] = (arr[i] ?? 0) + (arr[i - 1] ?? 0);
  }
  const monthKeys = Object.keys(byMonthDay);
  const historicalDailyCum: number[] = new Array(total).fill(0);
  if (monthKeys.length > 0) {
    for (let d = 0; d < total; d++) {
      let s = 0;
      for (const k of monthKeys) s += byMonthDay[k]![d] ?? 0;
      historicalDailyCum[d] = s / monthKeys.length;
    }
  }

  // Budget = avg monthly income (over history window) - savings target.
  // Income = sum of positive amounts per month, averaged.
  const incomeByMonth: Record<string, number> = {};
  for (const r of histRows) {
    if (r.amount <= 0) continue;
    const key = r.date.slice(0, 7);
    incomeByMonth[key] = (incomeByMonth[key] ?? 0) + r.amount;
  }
  const incomeMonthKeys = Object.keys(incomeByMonth);
  const trailingMonthlyIncome = incomeMonthKeys.length > 0
    ? incomeMonthKeys.reduce((s, k) => s + (incomeByMonth[k] ?? 0), 0) / incomeMonthKeys.length
    : 0;

  const settings = await db.select().from(budgetSettings).orderBy(sql`${budgetSettings.effectiveFrom} desc`).limit(1);
  const monthlySavingsTarget = settings[0]?.monthlySavingsTarget ?? 0;
  const monthlyBudget = computeMonthlyBudget({ monthlySavingsTarget, trailingMonthlyIncome });

  const points = buildSpendSeries({
    year,
    month1to12: month,
    todayDay,
    monthlyBudget,
    txns: monthTxns.map((t) => ({ date: t.date, amount: t.amount })),
    historicalDailyCum,
  });

  return c.json({
    month: monthArg,
    monthlyBudget,
    trailingMonthlyIncome,
    monthlySavingsTarget,
    points,
  });
});

// Per-category current-month spend vs trailing average.
summaryRoutes.get("/by-category", async (c) => {
  const q = c.req.query();
  const today = new Date();
  const monthArg = q.month ?? `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}`;
  const m = monthArg.match(/^(\d{4})-(\d{2})$/);
  if (!m) return c.json({ error: "month must be YYYY-MM" }, 400);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const historyMonths = Math.max(1, Math.min(24, Number(q.historyMonths ?? 6)));

  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const total = daysInMonth(year, month);
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(total).padStart(2, "0")}`;
  const histStart = isoMonthOffset(year, month, -historyMonths);
  const histEnd = isoMonthOffset(year, month, -1, true);

  const db = getDb();

  const current = await db
    .select({
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      total: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(
      gte(transactions.date, monthStart),
      lte(transactions.date, monthEnd),
      sql`${transactions.amount} < 0`,
    ))
    .groupBy(transactions.categoryId, categories.name);

  const hist = await db
    .select({
      categoryId: transactions.categoryId,
      total: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
    })
    .from(transactions)
    .where(and(
      gte(transactions.date, histStart),
      lte(transactions.date, histEnd),
      sql`${transactions.amount} < 0`,
      isNotNull(transactions.categoryId),
    ))
    .groupBy(transactions.categoryId);

  // Distinct months present in history window.
  const histMonthCount = await db
    .select({ n: sql<number>`count(distinct substr(${transactions.date}, 1, 7))` })
    .from(transactions)
    .where(and(gte(transactions.date, histStart), lte(transactions.date, histEnd)));
  const months = Math.max(1, histMonthCount[0]?.n ?? 1);

  const histById = new Map(hist.map((h) => [h.categoryId, h.total]));
  const out = current.map((row) => {
    const histTotal = histById.get(row.categoryId) ?? 0;
    return {
      categoryId: row.categoryId,
      categoryName: row.categoryName ?? "Uncategorized",
      currentSpend: -row.total,
      historicalAverage: -histTotal / months,
      transactionCount: row.count,
    };
  }).sort((a, b) => b.currentSpend - a.currentSpend);
  return c.json({ month: monthArg, categories: out });
});

// Tile-style summary numbers for the top of the dashboard.
summaryRoutes.get("/stats", async (c) => {
  const today = new Date();
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth(year, month)).padStart(2, "0")}`;

  const db = getDb();
  const mtdSpendRow = await db
    .select({ total: sql<number>`coalesce(sum(${transactions.amount}), 0)` })
    .from(transactions)
    .where(and(
      gte(transactions.date, monthStart),
      lte(transactions.date, monthEnd),
      sql`${transactions.amount} < 0`,
    ));
  const mtdIncomeRow = await db
    .select({ total: sql<number>`coalesce(sum(${transactions.amount}), 0)` })
    .from(transactions)
    .where(and(
      gte(transactions.date, monthStart),
      lte(transactions.date, monthEnd),
      sql`${transactions.amount} > 0`,
    ));
  const txnCountRow = await db
    .select({ n: sql<number>`count(*)` })
    .from(transactions)
    .where(and(gte(transactions.date, monthStart), lte(transactions.date, monthEnd)));

  return c.json({
    mtdSpend: -(mtdSpendRow[0]?.total ?? 0),
    mtdIncome: mtdIncomeRow[0]?.total ?? 0,
    mtdTransactionCount: txnCountRow[0]?.n ?? 0,
    asOf: today.toISOString(),
  });
});

// Helpers.

// Returns ISO date for first day of (year-month + offsetMonths). If `endOfMonth`
// is true, returns the last day of that month instead.
function isoMonthOffset(year: number, month1to12: number, offsetMonths: number, endOfMonth = false): string {
  const d = new Date(Date.UTC(year, month1to12 - 1 + offsetMonths, 1));
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  if (!endOfMonth) return `${y}-${String(m).padStart(2, "0")}-01`;
  const last = daysInMonth(y, m);
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}
