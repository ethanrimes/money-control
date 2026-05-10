import type { TransactionDTO } from "./types.js";

export interface BudgetInputs {
  monthlySavingsTarget: number; // dollars to save per month
  trailingMonthlyIncome: number; // average of recent months' income deposits
}

export function computeMonthlyBudget(inputs: BudgetInputs): number {
  return Math.max(0, inputs.trailingMonthlyIncome - inputs.monthlySavingsTarget);
}

export interface CumulativeSpendPoint {
  day: number;            // 1..daysInMonth
  actual: number | null;  // null for future days
  budget: number;         // straight-line budget by day
  historicalAvg: number;  // avg cumulative spend at this day across past months
}

export function daysInMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

// A transaction row reduced to what budget math needs. `categoryType` and
// `subcategoryName` come from the categories table (parent + subcategory).
// Null = uncategorized.
export interface CategorizedTxn {
  date: string;
  amount: number;
  categoryType: "expense" | "income" | "transfer" | null;
  subcategoryName: string | null;
}

// "Real income" excludes internal transfers in. Examples:
//   - "Income / Income - Salary": real income ✓
//   - "Income / Income - Transfer": NOT real income (Venmo from a friend,
//     internal account-to-account move, reimbursement)
//   - "Refunds" (category.type='income' with no transfer subcategory): real
//     income ✓ (paychecks + refunds are both legit positive cashflow)
//   - Uncategorized positive amount: NOT counted (conservative — avoid double
//     counting until the user labels it)
export function isRealIncome(t: CategorizedTxn): boolean {
  if (t.amount <= 0) return false;
  if (t.categoryType !== "income") return false;
  const sub = t.subcategoryName?.toLowerCase() ?? "";
  if (sub.includes("transfer")) return false;
  return true;
}

// "Real spend" excludes both income and transfers. A negative amount tagged
// 'transfer' (e.g., money sent to your savings account) is not consumption,
// so it shouldn't count against the budget.
export function isRealSpend(t: CategorizedTxn): boolean {
  if (t.amount >= 0) return false;
  if (t.categoryType === "income") return false; // refunds-as-negative don't exist in our data; defensive
  if (t.categoryType === "transfer") return false;
  return true;
}

// Group "real income" transactions by YYYY-MM and average over the months
// that actually had any income data. `monthCount` is the # of distinct
// months observed — if a month had zero income, we don't pull the average
// down with a divide-by-N including silent months.
export function aggregateTrailingIncome(txns: CategorizedTxn[]): {
  byMonth: Record<string, number>;
  monthsObserved: number;
  average: number;
} {
  const byMonth: Record<string, number> = {};
  for (const t of txns) {
    if (!isRealIncome(t)) continue;
    const key = t.date.slice(0, 7);
    byMonth[key] = (byMonth[key] ?? 0) + t.amount;
  }
  const keys = Object.keys(byMonth);
  const monthsObserved = keys.length;
  const total = keys.reduce((s, k) => s + (byMonth[k] ?? 0), 0);
  const average = monthsObserved > 0 ? total / monthsObserved : 0;
  return { byMonth, monthsObserved, average };
}

// Per-day cumulative spend, averaged across each month in the window. Day d
// of month M is the sum of all real-spend amounts on days 1..d of M.
// Output length = `daysInTargetMonth`, index 0 = day 1.
export function buildHistoricalDailyCum(
  txns: CategorizedTxn[],
  daysInTargetMonth: number,
): number[] {
  // 'YYYY-MM' -> [day1cum, day2cum, ..., day31cum]
  const byMonth: Record<string, number[]> = {};
  for (const t of txns) {
    if (!isRealSpend(t)) continue;
    const monthKey = t.date.slice(0, 7);
    const day = Number(t.date.slice(8, 10));
    if (!byMonth[monthKey]) byMonth[monthKey] = new Array(31).fill(0);
    byMonth[monthKey]![day - 1] += -t.amount;
  }
  // Cumulate per-month.
  for (const k of Object.keys(byMonth)) {
    const arr = byMonth[k]!;
    for (let i = 1; i < arr.length; i++) arr[i] = (arr[i] ?? 0) + (arr[i - 1] ?? 0);
  }
  // Average across months, truncated to target month's length.
  const monthKeys = Object.keys(byMonth);
  const out = new Array(daysInTargetMonth).fill(0);
  if (monthKeys.length === 0) return out;
  for (let d = 0; d < daysInTargetMonth; d++) {
    let s = 0;
    for (const k of monthKeys) s += byMonth[k]![d] ?? 0;
    out[d] = s / monthKeys.length;
  }
  return out;
}

// Build the cumulative-spend line series for a given month.
// `txns` should be already-filtered to the target month (real-spend filter is
// applied here so callers don't have to). `historicalDailyCum[d]` = average
// cumulative spend by day-of-month d across past months.
export function buildSpendSeries(args: {
  year: number;
  month1to12: number;
  todayDay: number;
  monthlyBudget: number;
  txns: Array<Pick<TransactionDTO, "date" | "amount"> & Partial<CategorizedTxn>>;
  historicalDailyCum: number[]; // length = daysInMonth, index 0 = day 1
}): CumulativeSpendPoint[] {
  const total = daysInMonth(args.year, args.month1to12);
  const dailyOutflow = new Array<number>(total + 1).fill(0);
  for (const t of args.txns) {
    const d = new Date(t.date).getUTCDate();
    if (d < 1 || d > total) continue;
    // If categorization info is present, honor the real-spend filter; else
    // fall back to "any negative amount counts" so the chart still works for
    // backward-compat callers.
    if ("categoryType" in t || "subcategoryName" in t) {
      const ct: CategorizedTxn = {
        date: t.date,
        amount: t.amount,
        categoryType: t.categoryType ?? null,
        subcategoryName: t.subcategoryName ?? null,
      };
      if (!isRealSpend(ct)) continue;
    } else if (t.amount >= 0) {
      continue;
    }
    dailyOutflow[d] += -t.amount;
  }
  const points: CumulativeSpendPoint[] = [];
  let cum = 0;
  for (let day = 1; day <= total; day++) {
    cum += dailyOutflow[day] ?? 0;
    points.push({
      day,
      actual: day <= args.todayDay ? cum : null,
      budget: (args.monthlyBudget * day) / total,
      historicalAvg: args.historicalDailyCum[day - 1] ?? 0,
    });
  }
  return points;
}
