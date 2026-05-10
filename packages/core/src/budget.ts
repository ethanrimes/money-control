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

// Build the cumulative-spend line series for a given month.
// `txns` should be already-filtered to outflows (negative amounts) for the month.
// `historicalDailyCum[d]` = average cumulative spend by day-of-month d across past months.
export function buildSpendSeries(args: {
  year: number;
  month1to12: number;
  todayDay: number;
  monthlyBudget: number;
  txns: Array<Pick<TransactionDTO, "date" | "amount">>;
  historicalDailyCum: number[]; // length = daysInMonth, index 0 = day 1
}): CumulativeSpendPoint[] {
  const total = daysInMonth(args.year, args.month1to12);
  const dailyOutflow = new Array<number>(total + 1).fill(0);
  for (const t of args.txns) {
    const d = new Date(t.date).getUTCDate();
    if (d >= 1 && d <= total && t.amount < 0) {
      dailyOutflow[d] += -t.amount;
    }
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
