import type { AccountType } from "./types.js";

// Plaid: a transaction's `amount` is POSITIVE for outflows (you spent it) and
// NEGATIVE for inflows (refunds, deposits). Our schema flips this to make
// summation natural: negative = outflow, positive = inflow. Always pipe
// Plaid's number through this helper before persisting.
export function normalizePlaidAmount(plaidAmount: number): number {
  // Avoid -0 when input is 0.
  if (plaidAmount === 0) return 0;
  return -plaidAmount;
}

// Plaid's `account.type` values: depository, credit, loan, investment,
// brokerage, other. Our schema models only two flavors; this collapses them.
export function normalizePlaidAccountType(plaidType: string): AccountType {
  if (plaidType === "credit" || plaidType === "loan") return "credit";
  return "depository";
}
