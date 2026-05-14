import { Hono } from "hono";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@moneycontrol/db";
import { accounts, balances, budgetSettings, categories, plaidItems, tellerEnrollments, transactions } from "@moneycontrol/db/schema";
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

  const [tellerEns, plaidIts] = await Promise.all([
    db.select().from(tellerEnrollments),
    db.select().from(plaidItems),
  ]);

  const allAccts = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      subtype: accounts.subtype,
      institution: accounts.institution,
      lastFour: accounts.lastFour,
      tellerEnrollmentId: accounts.tellerEnrollmentId,
      plaidItemId: accounts.plaidItemId,
      // Explicit table-qualified column names: Drizzle's sql template
      // does NOT auto-prefix outer-scope columns inside a correlated
      // subquery — without "accounts.id" the bare "id" resolves to
      // balances.id and the subquery never matches.
      latestBalance: sql<number | null>`(
        SELECT b.current FROM balances b
        WHERE b.account_id = accounts.id
        ORDER BY b.as_of_date DESC LIMIT 1
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
    signedBalance: a.type === "credit" ? -(a.latestBalance ?? 0) : (a.latestBalance ?? 0),
  });

  type Group = {
    kind: "teller" | "plaid" | "manual" | "seeded";
    enrollmentId: number;
    institutionName: string;
    createdAt: string;
    accounts: ReturnType<typeof toDTO>[];
  };

  const groups: Group[] = [
    ...tellerEns.map<Group>((en) => ({
      kind: "teller",
      enrollmentId: en.id,
      institutionName: en.institutionName,
      createdAt: en.createdAt instanceof Date ? en.createdAt.toISOString() : en.createdAt,
      accounts: allAccts.filter((a) => a.tellerEnrollmentId === en.id).map(toDTO),
    })),
    ...plaidIts.map<Group>((it) => ({
      kind: "plaid",
      enrollmentId: it.id,
      institutionName: it.institutionName,
      createdAt: it.createdAt instanceof Date ? it.createdAt.toISOString() : it.createdAt,
      accounts: allAccts.filter((a) => a.plaidItemId === it.id).map(toDTO),
    })),
  ];

  // Manual accounts: created via POST /accounts (always set subtype on create).
  // Seeded accounts: from xlsx import, no aggregator + no subtype. The user
  // chose to hide the latter from the UI; the former should stay visible.
  const orphans = allAccts.filter((a) => a.tellerEnrollmentId === null && a.plaidItemId === null);
  const manual = orphans.filter((a) => a.subtype !== null && a.subtype !== "");
  const seeded = orphans.filter((a) => a.subtype === null || a.subtype === "");
  if (manual.length > 0) {
    // Group manual accounts BY institution so multiple Amex deposit accounts
    // (HYSA + Rewards Checking) appear under one "American Express" header.
    const byInst = new Map<string, typeof manual>();
    for (const a of manual) {
      const inst = a.institution ?? "Manual";
      const arr = byInst.get(inst) ?? [];
      arr.push(a);
      byInst.set(inst, arr);
    }
    for (const [institutionName, accts] of byInst) {
      groups.push({
        kind: "manual",
        enrollmentId: 0,
        institutionName,
        createdAt: "",
        accounts: accts.map(toDTO),
      });
    }
  }
  if (seeded.length > 0) {
    groups.push({
      kind: "seeded",
      enrollmentId: 0,
      institutionName: "Unlinked accounts",
      createdAt: "",
      accounts: seeded.map(toDTO),
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
        SELECT b.current FROM balances b
        WHERE b.account_id = accounts.id
        ORDER BY b.as_of_date DESC LIMIT 1
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

// Monthly detail endpoints — same response shape, different filter. Power the
// /budget and /historical-avg tabs in the web UI.
//
//   /summary/income-detail  → months × isRealIncome transactions
//   /summary/spend-detail   → months × isRealSpend transactions
//
// Response:
//   {
//     currentMonth: "2026-05",
//     completedMonthCount: number,                    // # of fully-past months with data
//     totalOverCompletedMonths: number,                // sum of those months' totals
//     averageOverCompletedMonths: number,              // total / completedMonthCount
//     months: [{ month, isComplete, total, transactions: [...] }] (desc by month)
//   }
//
// "Completed" = month whose last day is strictly before today. Today's
// in-progress month appears in the list (so the user can see partial data)
// but is excluded from the rolling total.
summaryRoutes.get("/income-detail", async (c) => {
  return c.json(await buildMonthlyDetail("income", {}));
});
// Historical-avg view: optional ?throughDay=N (only count transactions on
// or before day N of each month — used for apples-to-apples comparison)
// and optional ?categoryId=N (filter to that top-level category OR specific
// subcategory; server detects which by reading the category's parent_id).
summaryRoutes.get("/spend-detail", async (c) => {
  const q = c.req.query();
  const throughDay = q.throughDay ? Math.max(1, Math.min(31, Number(q.throughDay))) : undefined;
  const categoryId = q.categoryId ? Number(q.categoryId) : undefined;
  return c.json(await buildMonthlyDetail("spend", { throughDay, categoryId }));
});

interface DetailOptions {
  throughDay?: number;
  categoryId?: number;
}

async function buildMonthlyDetail(mode: "income" | "spend", opts: DetailOptions) {
  const db = getDb();
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const currentMonth = todayIso.slice(0, 7);

  // Resolve the categoryId filter to "match on transactions.category_id" or
  // "match on transactions.subcategory_id" by inspecting the category row.
  let topLevelFilter: number | null = null;
  let subcategoryFilter: number | null = null;
  if (opts.categoryId !== undefined && Number.isFinite(opts.categoryId)) {
    const c = (await db.select().from(categories).where(eq(categories.id, opts.categoryId)).limit(1))[0];
    if (c) {
      if (c.parentId === null) topLevelFilter = c.id;
      else subcategoryFilter = c.id;
    }
  }

  // Pull every transaction with its categorization joined in. We could
  // restrict by date but for a personal-finance DB a full table scan is
  // cheap and lets us assemble the per-month buckets in one pass.
  const rows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      description: transactions.description,
      amount: transactions.amount,
      accountId: transactions.accountId,
      accountName: accounts.name,
      categoryId: transactions.categoryId,
      subcategoryId: transactions.subcategoryId,
      categoryName: cat.name,
      categoryType: cat.type,
      subcategoryName: sub.name,
    })
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(cat, eq(cat.id, transactions.categoryId))
    .leftJoin(sub, eq(sub.id, transactions.subcategoryId));

  const byMonth = new Map<string, Array<typeof rows[number]>>();
  for (const r of rows) {
    const ct = {
      date: r.date,
      amount: r.amount,
      categoryType: (r.categoryType ?? null) as CategorizedTxn["categoryType"],
      subcategoryName: r.subcategoryName,
    };
    const keep = mode === "income" ? isRealIncome(ct) : isRealSpend(ct);
    if (!keep) continue;
    // throughDay: include only transactions on or before day N of the month.
    // Lets the user compare "spend through day 15" across months even when
    // the current month hasn't ended yet.
    if (opts.throughDay !== undefined) {
      const day = Number(r.date.slice(8, 10));
      if (day > opts.throughDay) continue;
    }
    // Category filter — narrow to either a top-level category (match on
    // category_id) or a specific subcategory (match on subcategory_id).
    if (topLevelFilter !== null && r.categoryId !== topLevelFilter) continue;
    if (subcategoryFilter !== null && r.subcategoryId !== subcategoryFilter) continue;
    const monthKey = r.date.slice(0, 7);
    const arr = byMonth.get(monthKey) ?? [];
    arr.push(r);
    byMonth.set(monthKey, arr);
  }

  const monthKeys = [...byMonth.keys()].sort().reverse();
  const months = monthKeys.map((m) => {
    const txns = byMonth.get(m)!.sort((a, b) => a.date.localeCompare(b.date));
    const total = txns.reduce((s, t) => s + Math.abs(t.amount), 0);
    return {
      month: m,
      isComplete: m < currentMonth,
      total,
      transactions: txns.map((t) => ({
        id: t.id,
        date: t.date,
        description: t.description,
        amount: t.amount,
        accountId: t.accountId,
        accountName: t.accountName,
        categoryName: t.categoryName,
        subcategoryName: t.subcategoryName,
      })),
    };
  });

  const completed = months.filter((m) => m.isComplete);
  const totalOverCompletedMonths = completed.reduce((s, m) => s + m.total, 0);
  const completedMonthCount = completed.length;
  const averageOverCompletedMonths = completedMonthCount > 0
    ? totalOverCompletedMonths / completedMonthCount
    : 0;

  return {
    currentMonth,
    completedMonthCount,
    totalOverCompletedMonths,
    averageOverCompletedMonths,
    months,
  };
}

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
