// End-to-end test: seed a tiny in-memory-style DB on a temp file, run a
// transaction through resolveCategory, simulate a manual re-categorization
// via upsertRule, and confirm the next lookup picks up the new category.
//
// We exercise the real proxy bridge — so this also functions as an
// integration test for the SELECT-rewrite path.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/sqlite-proxy/migrator";

let tmpDbPath: string;

async function freshDb() {
  tmpDbPath = path.join(os.tmpdir(), `mc-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  process.env.DATABASE_FILE = tmpDbPath;
  // Lazy-import after env is set so the client picks up the override.
  const { getDb, getRawSqlite } = await import("../src/client.js");
  const db = getDb();
  const sqlite = getRawSqlite();
  const migrationsFolder = path.resolve(import.meta.dirname, "../drizzle");
  await migrate(
    db,
    async (queries) => {
      sqlite.exec("BEGIN");
      try {
        for (const q of queries) sqlite.exec(q);
        sqlite.exec("COMMIT");
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
    { migrationsFolder },
  );
  return { db };
}

test("resolveCategory picks the exact-match rule, then upsertRule replaces it", async (t) => {
  const { db } = await freshDb();
  const { categories, categorizationRules } = await import("../src/schema.js");
  const { resolveCategory, upsertRule } = await import("../../../apps/server/src/lib/categorize.js");

  // Seed two categories: Subscriptions(1) and Dining(2).
  const ins = await db.insert(categories).values([
    { name: "Subscriptions", parentId: null, type: "expense" },
    { name: "Dining", parentId: null, type: "expense" },
  ]).returning();
  const subId = ins[0]!.id;
  const dinId = ins[1]!.id;

  // Initial rule: "apple.com bill" -> Subscriptions.
  await db.insert(categorizationRules).values({
    matchText: "apple.com bill",
    matchType: "exact",
    categoryId: subId,
    subcategoryId: null,
  });

  const r1 = await resolveCategory(db, "Apple.com Bill");
  assert.equal(r1.categoryId, subId, "should pick Subscriptions for the seeded rule");

  // User re-categorizes a transaction with that description to Dining.
  await upsertRule(db, { description: "Apple.com Bill", categoryId: dinId, subcategoryId: null });

  const r2 = await resolveCategory(db, "Apple.com Bill");
  assert.equal(r2.categoryId, dinId, "should pick Dining after upsertRule overwrites the mapping");

  // A description with no rule returns null/null.
  const r3 = await resolveCategory(db, "Some Brand New Vendor");
  assert.equal(r3.categoryId, null);
  assert.equal(r3.subcategoryId, null);

  t.after(() => {
    try { fs.unlinkSync(tmpDbPath); } catch { /* ignore */ }
  });
});

test("resolveCategory: normalizes punctuation/case so casing doesn't miss the rule", async (t) => {
  const { db } = await freshDb();
  const { categories, categorizationRules } = await import("../src/schema.js");
  const { resolveCategory } = await import("../../../apps/server/src/lib/categorize.js");

  const ins = await db.insert(categories).values([
    { name: "Travel", parentId: null, type: "expense" },
  ]).returning();
  const catId = ins[0]!.id;

  // Rule stored with normalized form.
  await db.insert(categorizationRules).values({
    matchText: "uber trip",
    matchType: "exact",
    categoryId: catId,
    subcategoryId: null,
  });

  // Different cases / extra spaces / trailing reference number should still match.
  for (const desc of ["UBER TRIP", "Uber  Trip", "Uber Trip 1234567890"]) {
    const r = await resolveCategory(db, desc);
    assert.equal(r.categoryId, catId, `expected match for: ${desc}`);
  }

  t.after(() => {
    try { fs.unlinkSync(tmpDbPath); } catch { /* ignore */ }
  });
});
