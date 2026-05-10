// Regression tests for the SELECT-clause alias rewriter. The whole DB layer
// depends on this — every Drizzle query passes through it.

import test from "node:test";
import assert from "node:assert/strict";
import { aliasSelectColumns } from "../src/sql-rewrite.js";

test("rewrites bare columns to use _cN aliases", () => {
  const out = aliasSelectColumns(`select "a", "b", "c" from "t"`);
  assert.match(out, /"a" as "_c0"/);
  assert.match(out, /"b" as "_c1"/);
  assert.match(out, /"c" as "_c2"/);
});

test("forces unique aliases when two columns share a name (the bug we hit)", () => {
  const sql = `select "accounts"."name", "cat"."name", "sub"."name" from "transactions" left join "accounts" on x left join "categories" "cat" on y left join "categories" "sub" on z`;
  const out = aliasSelectColumns(sql);
  assert.match(out, /"accounts"\."name" as "_c0"/);
  assert.match(out, /"cat"\."name" as "_c1"/);
  assert.match(out, /"sub"\."name" as "_c2"/);
});

test("leaves already-aliased columns alone", () => {
  const sql = `select "a" as "alpha", "b" as "beta" from "t"`;
  const out = aliasSelectColumns(sql);
  // Should NOT add _c0 / _c1, since explicit aliases exist.
  assert.match(out, /"a" as "alpha"/);
  assert.match(out, /"b" as "beta"/);
  assert.doesNotMatch(out, /_c\d+/);
});

test("does not break SQL with subqueries in SELECT (subquery's inner SELECT is ignored)", () => {
  const sql = `select "id", (select max("x") from "y") from "t"`;
  const out = aliasSelectColumns(sql);
  // Outer columns should be aliased; the inner select's max(x) lives unchanged
  // inside the subquery.
  assert.match(out, /"id" as "_c0"/);
  assert.match(out, /\(select max\("x"\) from "y"\) as "_c1"/);
});

test("does not split inside parens (function calls with commas)", () => {
  const sql = `select coalesce("a", 0), coalesce("b", 0) from "t"`;
  const out = aliasSelectColumns(sql);
  assert.match(out, /coalesce\("a", 0\) as "_c0"/);
  assert.match(out, /coalesce\("b", 0\) as "_c1"/);
});

test("does not touch non-SELECT statements", () => {
  const insert = `insert into "t" ("a", "b") values (?, ?)`;
  assert.equal(aliasSelectColumns(insert), insert);
  const update = `update "t" set "a" = ?, "b" = ? where "id" = ?`;
  assert.equal(aliasSelectColumns(update), update);
});

test("handles SELECT DISTINCT", () => {
  const out = aliasSelectColumns(`select distinct "a", "b" from "t"`);
  assert.match(out, /"a" as "_c0"/);
  assert.match(out, /"b" as "_c1"/);
});

test("does not touch FROM keyword inside a string literal", () => {
  // The literal contains 'from'; it must not be picked up as the FROM clause.
  const sql = `select 'hello from inside', "x" from "t"`;
  const out = aliasSelectColumns(sql);
  assert.match(out, /'hello from inside' as "_c0"/);
  assert.match(out, /"x" as "_c1"/);
});
