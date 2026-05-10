import test from "node:test";
import assert from "node:assert/strict";
import { signAccountBalance } from "../src/types.js";

test("signAccountBalance: credit accounts get a negative sign (debt)", () => {
  assert.equal(signAccountBalance("credit", 1200.50), -1200.50);
});

test("signAccountBalance: depository accounts stay positive (cash)", () => {
  assert.equal(signAccountBalance("depository", 5000), 5000);
});

test("signAccountBalance: zero is zero on either side", () => {
  assert.equal(signAccountBalance("credit", 0), 0);
  assert.equal(signAccountBalance("depository", 0), 0);
});

test("signAccountBalance: summing signed balances yields net cash position", () => {
  const accounts = [
    { type: "depository" as const, balance: 5000 },     // +5000 (BofA Checking)
    { type: "depository" as const, balance: 12000 },    // +12000 (HYSA)
    { type: "credit" as const, balance: 1500 },         // -1500 (Amex card)
    { type: "credit" as const, balance: 800 },          // -800  (Capital One)
  ];
  const net = accounts.reduce((s, a) => s + signAccountBalance(a.type, a.balance), 0);
  // 5000 + 12000 - 1500 - 800 = 14700
  assert.equal(net, 14700);
});
