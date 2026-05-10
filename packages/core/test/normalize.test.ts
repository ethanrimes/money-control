import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDescription } from "../src/normalize.js";

test("normalize: lowercases and collapses whitespace", () => {
  assert.equal(normalizeDescription("Apple   Bill"), "apple bill");
});

test("normalize: strips '*' suffixes used by card processors", () => {
  // 'AMZN MKTP US*A1B2C3' should collapse to a stable rule key.
  const a = normalizeDescription("AMZN Mktp US*A1B2C3");
  const b = normalizeDescription("AMZN Mktp US*Z9Y8X7");
  assert.equal(a, b, "different *suffix tags should produce identical keys");
  assert.match(a, /amzn mktp us/);
});

test("normalize: strips long digit runs (transaction reference numbers)", () => {
  const a = normalizeDescription("UBER TRIP 1234567890");
  const b = normalizeDescription("UBER TRIP 9876543210");
  assert.equal(a, b);
});

test("normalize: keeps short numerics that are part of brand names", () => {
  // A 3-digit number is short enough to be brand-relevant (e.g. 'Chase 401k').
  const out = normalizeDescription("FOO 123");
  assert.match(out, /\b123\b/);
});

test("normalize: removes punctuation but keeps domain-meaningful chars", () => {
  const out = normalizeDescription("Apple.com/Bill — $9.99 monthly!");
  // Should still contain 'apple.com/bill' and '9.99'.
  assert.match(out, /apple\.com\/bill/);
  assert.match(out, /9\.99/);
  // No exclamation, em-dash, or dollar sign.
  assert.doesNotMatch(out, /[!—$]/);
});

test("normalize: returns empty string for whitespace-only input", () => {
  assert.equal(normalizeDescription("   "), "");
  assert.equal(normalizeDescription(""), "");
});
