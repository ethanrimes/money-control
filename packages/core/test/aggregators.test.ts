import test from "node:test";
import assert from "node:assert/strict";
import { normalizePlaidAccountType, normalizePlaidAmount } from "../src/aggregators.js";

// ----- Plaid amount sign convention -----
// Plaid: positive = outflow (Starbucks $5.43 → +5.43)
// Ours: negative = outflow (Starbucks $5.43 → -5.43)
// Every Plaid amount must pass through normalizePlaidAmount on insert.

test("normalizePlaidAmount: Plaid +5.43 (outflow) → our -5.43", () => {
  assert.equal(normalizePlaidAmount(5.43), -5.43);
});

test("normalizePlaidAmount: Plaid -200 (refund / deposit) → our +200", () => {
  assert.equal(normalizePlaidAmount(-200), 200);
});

test("normalizePlaidAmount: zero stays zero (no -0)", () => {
  assert.equal(normalizePlaidAmount(0), 0);
  assert.notEqual(Object.is(normalizePlaidAmount(0), -0), true);
});

// ----- Plaid account type collapse -----
// Plaid distinguishes depository / credit / loan / investment / brokerage.
// Our schema models only depository + credit.

test("normalizePlaidAccountType: 'credit' stays 'credit'", () => {
  assert.equal(normalizePlaidAccountType("credit"), "credit");
});

test("normalizePlaidAccountType: 'loan' collapses to 'credit' (still debt)", () => {
  assert.equal(normalizePlaidAccountType("loan"), "credit");
});

test("normalizePlaidAccountType: 'depository' stays 'depository'", () => {
  assert.equal(normalizePlaidAccountType("depository"), "depository");
});

test("normalizePlaidAccountType: 'investment' + 'brokerage' collapse to 'depository' (asset side)", () => {
  // Fidelity brokerage / IRA / 401k are reported as 'investment' or
  // 'brokerage' by Plaid. Without a dedicated investments table they show
  // up as depository-flavored "money you have" — accurate for net cash.
  assert.equal(normalizePlaidAccountType("investment"), "depository");
  assert.equal(normalizePlaidAccountType("brokerage"), "depository");
});

test("normalizePlaidAccountType: unknown types default to 'depository' (conservative — won't double-count debt)", () => {
  assert.equal(normalizePlaidAccountType("other"), "depository");
  assert.equal(normalizePlaidAccountType("unexpected_value"), "depository");
});
