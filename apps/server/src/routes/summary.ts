import { Hono } from "hono";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { getDb } from "@moneycontrol/db";
import { accounts, balances, budgetSettings, categories, tellerEnrollments, transactions } from "@moneycontrol/db/schema";
import {
  aggregateTrailingIncome,
  buildHistoricalDailyCum,
  buildSpendSeries,
  computeMonthlyBudget,
  daysInMonth,
  isRealIncome,
  isRealSpend,
  type CategorizedTxn,
} from "@moneycontrol/core";

export const summaryRoutes = new Hono();

// Aliases used by every join in this file. `cat` = parent category,
// `sub` = subcategory. Both are LEFT JOINs since transactions can be
// uncategorized.
const cat = alias(categories, "cat");
const sub = alias(categories, "sub");

// All accounts, grouped by aggregator enrollment + orphans, with net cash
// totals. Single endpoint for the "Linked institutions" card so it doesn't
// need to weave together /teller/enrollments + /accounts + /summary/net-cash.
summaryRoutes.get("/accounts", async (c) => {
  const db = getDb();

  const ens = await db.select().from(tellerEnrollments);

  const allAccts = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      institution: accounts.institution,
      lastFour: accounts.lastFour,
      tellerEnrollmentId: accounts.tellerEnrollmentId,
      latestBalance: sql<number | null>`(
        SELECT current FROM ${balances}
        WHERE ${balances.accountId} = ${accounts.id}
        ORDER BY ${balances.asOfDate} DESC LIMIT 1
      )`,
    })
    .from(accounts);

  const toDTO = (a: typeof allAccts[number]) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    institution: a.institution,
    lastFour: a.lastFour,
    balance: a.latestBalance ?? 0,
    // Signed balance: depository positive, credit negative.
    signedBalance: a.type === "credit" ? -(a.latestBalance ?? 0) : (a.latestBalance ?? 0),
  });

  const groups = ens.map((en) => ({
    kind: "teller" as const,
    enrollmentId: en.id,
    institutionName: en.institutionName,
    createdAt: en.createdAt,
    accounts: allAccts.filter((a) => a.tellerEnrollmentId === en.id).map(toDTO),
  }));

  const orphans = allAccts.filter((a) => a.tellerEnrollmentId === null);
  if (orphans.length > 0) {
    groups.push({
      kind: "teller" as const,
      enrollmentId: 0,
      institutionName: "Unlinked accounts",
      createdAt: "",
      accounts: orphans.map(toDTO),
    });
  }

  const allDtos = allAccts.map(toDTO);
  const totalDepository = allDtos.filter((a) => a.type === "depository").reduce((s, a) => s + a.balance, 0);
  const totalCredit = allDtos.filter((a) => a.type === "credit").reduce((s, a) => s + a.balance, 0);
  const netCash = totalDepository - totalCredit;

  return c.json({ groups, totalDepository, totalCredit, netCash });
});

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

  const monthTxns = await selectCategorized(db, monthStart, monthEnd);

  const histStart = isoMonthOffset(year, month, -historyMonths);
  const histEnd = isoMonthOffset(year, month, -1, true);
  const histTxns = await selectCategorized(db, histStart, histEnd);

  const incomeAgg = aggregateTrailingIncome(histTxns);
  const trailingMonthlyIncome = incomeAgg.average;
  const historicalDailyCum = buildHistoricalDailyCum(histTxns, total);

  const settings = await db.select().from(budgetSettings).orderBy(sql`${budgetSettings.effectiveFrom} desc`).limit(1);
  const monthlySavingsTarget = settings[0]?.monthlySavingsTarget ?? 0;
  const monthlyBudget = computeMonthlyBudget({ monthlySavingsTarget, trailingMonthlyIncome });

  const points = buildSpendSeries({
    year,
    month1to12: month,
    todayDay,
    monthlyBudget,
    txns: monthTxns,
    historicalDailyCum,
  });

  // Also surface trailing spend so the UI can show users why the budget
  // looks the way it does. Avg per month over the same window.
  let trailingSpendTotal = 0;
  for (const t of histTxns) if (isRealSpend(t)) trailingSpendTotal += -t.amount;
  const trailingMonthlySpend = incomeAgg.monthsObserved > 0
    ? trailingSpendTotal / Math.max(1, incomeAgg.monthsObserved)
    : 0;

  return c.json({
    month: monthArg,
    monthlyBudget,
    trailingMonthlyIncome,
    trailingMonthlySpend,
    monthlySavingsTarget,
    monthsObserved: incomeAgg.monthsObserved,
    points,
  });
});

// Per-category current-month spend vs trailing average.
// Excludes income + transfer categories from "spend" so they don't pollute
// the bars.
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

  // Pull both windows fully-categorized, then aggregate in JS so we can
  // apply the same isRealSpend filter the budget chart uses.
  const monthTxns = await selectCategorized(db, monthStart, monthEnd);
  const histTxns = await selectCategorized(db, histStart, histEnd);

  // Distinct months actually present in the history window.
  const monthsObserved = new Set(histTxns.map((t) => t.date.slice(0, 7))).size || 1;

  const monthByCat = new Map<number | null, { name: string; spend: number; count: number }>();
  for (const t of monthTxns) {
    if (!isRealSpend(t)) continue;
    const key = t.categoryId ?? null;
    const name = t.categoryName ?? "Uncategorized";
    const cur = monthByCat.get(key) ?? { name, spend: 0, count: 0 };
    cur.spend += -t.amount;
    cur.count += 1;
    monthByCat.set(key, cur);
  }

  const histByCat = new Map<number | null, number>();
  for (const t of histTxns) {
    if (!isRealSpend(t)) continue;
    const key = t.categoryId ?? null;
    histByCat.set(key, (histByCat.get(key) ?? 0) + -t.amount);
  }

  const out = Array.from(monthByCat.entries()).map(([id, v]) => ({
    categoryId: id,
    categoryName: v.name,
    currentSpend: v.spend,
    historicalAverage: (histByCat.get(id) ?? 0) / monthsObserved,
    transactionCount: v.count,
  })).sort((a, b) => b.currentSpend - a.currentSpend);

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
  const txns = await selectCategorized(db, monthStart, monthEnd);

  let mtdSpend = 0;
  let mtdIncome = 0;
  for (const t of txns) {
    if (isRealSpend(t)) mtdSpend += -t.amount;
    else if (isRealIncome(t)) mtdIncome += t.amount;
  }
  return c.json({
    mtdSpend,
    mtdIncome,
    mtdTransactionCount: txns.length,
    asOf: today.toISOString(),
  });
});

// Helpers.

// Pull every transaction in [from, to] joined with its parent category and
// subcategory so we have type + names available for the budget filters.
async function selectCategorized(
  db: ReturnType<typeof getDb>,
  from: string,
  to: string,
): Promise<Array<CategorizedTxn & { categoryId: number | null; categoryName: string | null }>> {
  const rows = await db
    .select({
      date: transactions.date,
      amount: transactions.amount,
      categoryId: transactions.categoryId,
      categoryName: cat.name,
      categoryType: cat.type,
      subcategoryName: sub.name,
    })
    .from(transactions)
    .leftJoin(cat, eq(cat.id, transactions.categoryId))
    .leftJoin(sub, eq(sub.id, transactions.subcategoryId))
    .where(and(gte(transactions.date, from), lte(transactions.date, to)));
  return rows.map((r) => ({
    date: r.date,
    amount: r.amount,
    categoryId: r.categoryId,
    categoryName: r.categoryName,
    categoryType: (r.categoryType ?? null) as CategorizedTxn["categoryType"],
    subcategoryName: r.subcategoryName,
  }));
}

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
