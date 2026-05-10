import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateTrailingIncome,
  buildHistoricalDailyCum,
  buildSpendSeries,
  computeMonthlyBudget,
  daysInMonth,
  isRealIncome,
  isRealSpend,
  type CategorizedTxn,
} from "../src/budget.js";

// ----- legacy unit coverage (kept) -----

test("computeMonthlyBudget: income minus savings target", () => {
  assert.equal(computeMonthlyBudget({ trailingMonthlyIncome: 5000, monthlySavingsTarget: 1000 }), 4000);
});

test("computeMonthlyBudget: floors at zero (savings target can't push budget negative)", () => {
  assert.equal(computeMonthlyBudget({ trailingMonthlyIncome: 1000, monthlySavingsTarget: 5000 }), 0);
});

test("daysInMonth: leap year handling", () => {
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2025, 2), 28);
  assert.equal(daysInMonth(2026, 4), 30);
  assert.equal(daysInMonth(2026, 12), 31);
});

// ----- isRealIncome predicate -----

test("isRealIncome: counts positive amounts in 'income' category", () => {
  assert.equal(isRealIncome({ date: "2026-01-15", amount: 5000, categoryType: "income", subcategoryName: "Income - Salary" }), true);
});

test("isRealIncome: rejects 'Income - Transfer' subcategory (Venmo from a friend, internal moves)", () => {
  assert.equal(isRealIncome({ date: "2026-01-15", amount: 500, categoryType: "income", subcategoryName: "Income - Transfer" }), false);
});

test("isRealIncome: rejects uncategorized positive amounts (conservative — don't double-count)", () => {
  assert.equal(isRealIncome({ date: "2026-01-15", amount: 500, categoryType: null, subcategoryName: null }), false);
});

test("isRealIncome: rejects non-income category types even if positive", () => {
  assert.equal(isRealIncome({ date: "2026-01-15", amount: 30, categoryType: "expense", subcategoryName: "Dining" }), false);
  assert.equal(isRealIncome({ date: "2026-01-15", amount: 100, categoryType: "transfer", subcategoryName: null }), false);
});

test("isRealIncome: rejects negative amounts even with income type (defensive)", () => {
  assert.equal(isRealIncome({ date: "2026-01-15", amount: -100, categoryType: "income", subcategoryName: "Income - Salary" }), false);
});

// ----- isRealSpend predicate -----

test("isRealSpend: counts negative amounts in 'expense' category", () => {
  assert.equal(isRealSpend({ date: "2026-01-10", amount: -27.66, categoryType: "expense", subcategoryName: "Dining" }), true);
});

test("isRealSpend: counts uncategorized outflows (default to spend until labeled)", () => {
  // Same conservative-yet-honest stance: if it's a negative amount we don't
  // know about, we still count it as spend so the budget reflects reality.
  assert.equal(isRealSpend({ date: "2026-01-10", amount: -50, categoryType: null, subcategoryName: null }), true);
});

test("isRealSpend: rejects negative transfers (moving money to savings isn't consumption)", () => {
  assert.equal(isRealSpend({ date: "2026-01-10", amount: -2000, categoryType: "transfer", subcategoryName: null }), false);
});

test("isRealSpend: rejects positive amounts even when expense-typed", () => {
  assert.equal(isRealSpend({ date: "2026-01-10", amount: 50, categoryType: "expense", subcategoryName: null }), false);
});

// ----- aggregateTrailingIncome -----

test("aggregateTrailingIncome: filters out transfers, averages over months OBSERVED", () => {
  const txns: CategorizedTxn[] = [
    // Jan: $5k salary + $1k transfer-in
    { date: "2026-01-15", amount: 5000, categoryType: "income", subcategoryName: "Income - Salary" },
    { date: "2026-01-20", amount: 1000, categoryType: "income", subcategoryName: "Income - Transfer" },
    // Feb: $5k salary only
    { date: "2026-02-15", amount: 5000, categoryType: "income", subcategoryName: "Income - Salary" },
    // Mar: no income at all (gap month)
  ];
  const r = aggregateTrailingIncome(txns);
  assert.equal(r.monthsObserved, 2, "should ignore the silent Mar month, not divide by 3");
  assert.equal(r.byMonth["2026-01"], 5000, "Jan transfer-in must be excluded from income");
  assert.equal(r.byMonth["2026-02"], 5000);
  assert.equal(r.average, 5000);
});

test("aggregateTrailingIncome: returns zero average when no real income at all", () => {
  const txns: CategorizedTxn[] = [
    { date: "2026-01-10", amount: -100, categoryType: "expense", subcategoryName: "Dining" },
    { date: "2026-01-20", amount: 200, categoryType: "income", subcategoryName: "Income - Transfer" },
  ];
  const r = aggregateTrailingIncome(txns);
  assert.equal(r.monthsObserved, 0);
  assert.equal(r.average, 0);
});

// ----- buildHistoricalDailyCum -----

test("buildHistoricalDailyCum: averages cumulative spend across months", () => {
  // Two months of expense data. Day 5 cumulative: month A = $100, month B = $200.
  // Average at day 5 should be $150.
  const txns: CategorizedTxn[] = [
    { date: "2026-01-01", amount: -50, categoryType: "expense", subcategoryName: null },
    { date: "2026-01-05", amount: -50, categoryType: "expense", subcategoryName: null },
    { date: "2026-02-03", amount: -100, categoryType: "expense", subcategoryName: null },
    { date: "2026-02-04", amount: -100, categoryType: "expense", subcategoryName: null },
  ];
  const cum = buildHistoricalDailyCum(txns, 30);
  assert.equal(cum.length, 30);
  assert.equal(cum[0], (50 + 0) / 2, "day 1: Jan $50, Feb $0 → avg $25");
  assert.equal(cum[4], (100 + 200) / 2, "day 5: Jan $100 cum, Feb $200 cum → avg $150");
  assert.equal(cum[29], (100 + 200) / 2, "end of month: same as last txn day since nothing later");
});

test("buildHistoricalDailyCum: excludes transfers from the trend line", () => {
  // A big transfer-out on day 1 must not show up in the cumulative spend.
  const txns: CategorizedTxn[] = [
    { date: "2026-01-01", amount: -5000, categoryType: "transfer", subcategoryName: null },
    { date: "2026-01-02", amount: -50, categoryType: "expense", subcategoryName: "Dining" },
  ];
  const cum = buildHistoricalDailyCum(txns, 30);
  assert.equal(cum[0], 0, "day 1: only the transfer → must be excluded");
  assert.equal(cum[1], 50, "day 2: $50 dining only");
});

test("buildHistoricalDailyCum: returns zeros when no history", () => {
  const cum = buildHistoricalDailyCum([], 30);
  assert.equal(cum.length, 30);
  assert.ok(cum.every((v) => v === 0));
});

// ----- buildSpendSeries integration -----

test("buildSpendSeries: returns one point per day, stops actuals at todayDay", () => {
  const points = buildSpendSeries({
    year: 2026,
    month1to12: 4, // 30 days
    todayDay: 10,
    monthlyBudget: 3000,
    txns: [
      { date: "2026-04-01", amount: -100 },
      { date: "2026-04-05", amount: -50 },
      { date: "2026-04-15", amount: -200 },
    ],
    historicalDailyCum: new Array(30).fill(0),
  });
  assert.equal(points.length, 30);
  assert.equal(points[9]!.actual, 150);
  assert.equal(points[14]!.actual, null);
  assert.equal(points[29]!.budget, 3000);
  assert.equal(Math.round(points[14]!.budget), 1500);
});

test("buildSpendSeries: when categorized, applies isRealSpend (transfers excluded)", () => {
  const points = buildSpendSeries({
    year: 2026,
    month1to12: 4,
    todayDay: 10,
    monthlyBudget: 3000,
    txns: [
      { date: "2026-04-01", amount: -100, categoryType: "expense", subcategoryName: "Dining" },
      { date: "2026-04-02", amount: -2000, categoryType: "transfer", subcategoryName: null },
      { date: "2026-04-03", amount: 5000, categoryType: "income", subcategoryName: "Income - Salary" },
    ],
    historicalDailyCum: new Array(30).fill(0),
  });
  assert.equal(points[2]!.actual, 100, "only the $100 dining counts; transfer + income excluded");
});

test("buildSpendSeries (uncategorized fallback): any negative amount counts as spend", () => {
  // No categoryType / subcategoryName fields present → fallback "negative = spend".
  const points = buildSpendSeries({
    year: 2026,
    month1to12: 4,
    todayDay: 5,
    monthlyBudget: 1000,
    txns: [
      { date: "2026-04-01", amount: 5000 },
      { date: "2026-04-02", amount: -100 },
    ],
    historicalDailyCum: new Array(30).fill(0),
  });
  assert.equal(points[0]!.actual, 0);
  assert.equal(points[1]!.actual, 100);
  assert.equal(points[4]!.actual, 100);
});
