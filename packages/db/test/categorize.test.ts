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
  // Reset the singleton cache so the new DATABASE_FILE actually takes effect.
  const { getDb, getRawSqlite, __resetForTests } = await import("../src/client.js");
  __resetForTests();
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

test("categories CRUD: create top-level + subcategory, rename, delete-promote, delete-cascade", async (t) => {
  const { db } = await freshDb();
  const { categories } = await import("../src/schema.js");
  const { eq, isNull, and } = await import("drizzle-orm");

  // Create top-level "Food"; create subcategory "Dining" under it.
  const food = (await db.insert(categories).values({ name: "Food", type: "expense" }).returning())[0]!;
  const dining = (await db.insert(categories).values({ name: "Dining", parentId: food.id, type: "expense" }).returning())[0]!;
  const groceries = (await db.insert(categories).values({ name: "Groceries", parentId: food.id, type: "expense" }).returning())[0]!;

  // Rename "Food" to "Food & Drink".
  await db.update(categories).set({ name: "Food & Drink" }).where(eq(categories.id, food.id));
  const renamed = (await db.select().from(categories).where(eq(categories.id, food.id)))[0]!;
  assert.equal(renamed.name, "Food & Drink");

  // Delete-promote: child subcategories get parentId set to null (the
  // categories.ts route does this when ?cascade=0).
  await db.update(categories).set({ parentId: null }).where(eq(categories.parentId, food.id));
  await db.delete(categories).where(eq(categories.id, food.id));
  const after = await db.select().from(categories);
  assert.equal(after.find((r) => r.id === food.id), undefined, "Food should be gone");
  const promotedDining = after.find((r) => r.id === dining.id);
  assert.equal(promotedDining?.parentId, null, "Dining should be promoted to top-level");

  // Cascade delete: insert "Travel" + child "Hotel"; delete with cascade.
  const travel = (await db.insert(categories).values({ name: "Travel", type: "expense" }).returning())[0]!;
  await db.insert(categories).values({ name: "Hotel", parentId: travel.id, type: "expense" });
  await db.delete(categories).where(eq(categories.parentId, travel.id));
  await db.delete(categories).where(eq(categories.id, travel.id));
  const final = await db.select().from(categories);
  assert.equal(final.some((r) => r.name === "Travel" || r.name === "Hotel"), false, "cascade delete should remove both");

  void groceries; // referenced for clarity
  t.after(() => {
    try { fs.unlinkSync(tmpDbPath); } catch { /* ignore */ }
  });
});

test("backfillRule: labels every uncategorized matching transaction, leaves others alone", async (t) => {
  const { db } = await freshDb();
  const { accounts, categories, transactions } = await import("../src/schema.js");
  const { backfillRule } = await import("../../../apps/server/src/lib/categorize.js");

  // 1 account, 1 expense category, 1 transfer category.
  const acct = (await db.insert(accounts).values({ name: "Test", type: "depository" }).returning())[0]!;
  const cats = await db.insert(categories).values([
    { name: "Transfers", parentId: null, type: "transfer" },
    { name: "Dining", parentId: null, type: "expense" },
  ]).returning();
  const transferCatId = cats[0]!.id;
  const diningCatId = cats[1]!.id;

  // Seed 5 transactions. Descriptions chosen so the first 3 all normalize to
  // the same key ("wise transfer ref"), while w4 + w5 don't.
  //   - 3 uncategorized "Wise Transfer ref ..." with differing long refnos
  //     (normalize strips 6+ digit runs → identical keys)
  //   - 1 already-categorized w/ matching description → should NOT be touched
  //   - 1 unrelated "Starbucks" uncategorized → should NOT be touched
  const inserts = await db.insert(transactions).values([
    { accountId: acct.id, date: "2026-04-01", description: "Wise Transfer ref 12345678", rawDescription: "x", amount: -100, source: "manual" },
    { accountId: acct.id, date: "2026-04-02", description: "Wise Transfer ref 87654321", rawDescription: "x", amount: -50, source: "manual" },
    { accountId: acct.id, date: "2026-04-03", description: "WISE TRANSFER REF 55555555", rawDescription: "x", amount: -200, source: "manual" },
    { accountId: acct.id, date: "2026-04-04", description: "Wise Transfer ref 99999999", rawDescription: "x", amount: -25, source: "manual", categoryId: diningCatId },
    { accountId: acct.id, date: "2026-04-05", description: "Starbucks Order", rawDescription: "x", amount: -7, source: "manual" },
  ]).returning();
  const [w1, w2, w3, w4, w5] = inserts;

  // User just labeled w1 as Transfers. Backfill should pick up w2 + w3 but
  // leave w4 alone (already categorized) and w5 (different description).
  const count = await backfillRule(db, {
    description: "Wise Transfer ref 12345678",
    categoryId: transferCatId,
    subcategoryId: null,
    excludeId: w1!.id,
  });
  assert.equal(count, 2, "should match the two other uncategorized Wise transfers");

  const after = await db.select().from(transactions);
  const byId = new Map(after.map((r) => [r.id, r]));
  assert.equal(byId.get(w2!.id)!.categoryId, transferCatId, "w2 should be backfilled");
  assert.equal(byId.get(w3!.id)!.categoryId, transferCatId, "w3 should be backfilled (different case but normalized matches)");
  assert.equal(byId.get(w4!.id)!.categoryId, diningCatId, "w4 already categorized: must stay Dining");
  assert.equal(byId.get(w5!.id)!.categoryId, null, "w5 unrelated: must stay uncategorized");

  t.after(() => {
    try { fs.unlinkSync(tmpDbPath); } catch { /* ignore */ }
  });
});
