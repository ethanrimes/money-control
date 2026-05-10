import test from "node:test";
import assert from "node:assert/strict";
import { computeMonthlyBudget, daysInMonth, buildSpendSeries } from "../src/budget.js";

test("computeMonthlyBudget: income minus savings target", () => {
  assert.equal(computeMonthlyBudget({ trailingMonthlyIncome: 5000, monthlySavingsTarget: 1000 }), 4000);
});

test("computeMonthlyBudget: floors at zero (savings target can't push budget negative)", () => {
  assert.equal(computeMonthlyBudget({ trailingMonthlyIncome: 1000, monthlySavingsTarget: 5000 }), 0);
});

test("daysInMonth: leap year handling", () => {
  assert.equal(daysInMonth(2024, 2), 29); // 2024 is a leap year
  assert.equal(daysInMonth(2025, 2), 28);
  assert.equal(daysInMonth(2026, 4), 30);
  assert.equal(daysInMonth(2026, 12), 31);
});

test("buildSpendSeries: returns one point per day, stops actuals at todayDay", () => {
  const points = buildSpendSeries({
    year: 2026,
    month1to12: 4, // 30 days
    todayDay: 10,
    monthlyBudget: 3000,
    txns: [
      { date: "2026-04-01", amount: -100 },
      { date: "2026-04-05", amount: -50 },
      { date: "2026-04-15", amount: -200 }, // after today; should not be included in `actual` (it's a future txn)
    ],
    historicalDailyCum: new Array(30).fill(0),
  });

  assert.equal(points.length, 30);
  // Day 10 actual should be 100 + 50 = 150 (the day-15 txn is "future" relative to todayDay,
  // but still appears in the sum-of-month txns. buildSpendSeries does cumulative on days <= todayDay).
  assert.equal(points[9]!.actual, 150);
  // Day 15 actual is null (after todayDay).
  assert.equal(points[14]!.actual, null);
  // Budget straight-line: day 30 = full budget; day 15 = half-ish.
  assert.equal(points[29]!.budget, 3000);
  assert.equal(Math.round(points[14]!.budget), 1500);
});

test("buildSpendSeries: ignores positive amounts (income is not spend)", () => {
  const points = buildSpendSeries({
    year: 2026,
    month1to12: 4,
    todayDay: 5,
    monthlyBudget: 1000,
    txns: [
      { date: "2026-04-01", amount: 5000 },  // income — should NOT count
      { date: "2026-04-02", amount: -100 },  // spend
    ],
    historicalDailyCum: new Array(30).fill(0),
  });
  assert.equal(points[0]!.actual, 0); // no spend on day 1
  assert.equal(points[1]!.actual, 100); // day 2 has the only spend
  assert.equal(points[4]!.actual, 100); // unchanged through day 5
});
