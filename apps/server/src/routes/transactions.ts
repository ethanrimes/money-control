import { Hono } from "hono";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { getDb } from "@moneycontrol/db";
import { transactions, accounts, categories } from "@moneycontrol/db/schema";
import { backfillRule, upsertRule } from "../lib/categorize.js";

export const transactionsRoutes = new Hono();

// Aliases keep the two joins on `categories` from colliding on column names
// (`name`, `id`, etc.) when the proxy adapter materializes rows.
const cat = alias(categories, "cat");
const sub = alias(categories, "sub");

// GET /transactions?from=YYYY-MM-DD&to=YYYY-MM-DD&accountId=&categoryId=&limit=100&offset=0
transactionsRoutes.get("/", async (c) => {
  const db = getDb();
  const q = c.req.query();
  const filters = [];
  if (q.from) filters.push(gte(transactions.date, q.from));
  if (q.to) filters.push(lte(transactions.date, q.to));
  if (q.accountId) filters.push(eq(transactions.accountId, Number(q.accountId)));
  if (q.categoryId) filters.push(eq(transactions.categoryId, Number(q.categoryId)));
  const limit = Math.min(Number(q.limit ?? 200), 1000);
  const offset = Number(q.offset ?? 0);

  const rows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      description: transactions.description,
      amount: transactions.amount,
      accountId: transactions.accountId,
      accountName: accounts.name,
      categoryId: transactions.categoryId,
      categoryName: cat.name,
      subcategoryId: transactions.subcategoryId,
      subcategoryName: sub.name,
      source: transactions.source,
      notes: transactions.notes,
    })
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(cat, eq(cat.id, transactions.categoryId))
    .leftJoin(sub, eq(sub.id, transactions.subcategoryId))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(transactions.date), desc(transactions.id))
    .limit(limit)
    .offset(offset);

  return c.json(rows);
});

// PATCH /transactions/:id  { categoryId?, subcategoryId?, notes? }
//   When category changes, upsert a categorization_rules entry so that future
//   transactions with the same normalized description auto-pick this mapping.
transactionsRoutes.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
  const body = await c.req.json().catch(() => ({})) as {
    categoryId?: number | null;
    subcategoryId?: number | null;
    notes?: string | null;
  };

  const db = getDb();
  const before = await db.select().from(transactions).where(eq(transactions.id, id)).limit(1);
  if (before.length === 0) return c.json({ error: "not found" }, 404);
  const txn = before[0]!;

  const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if ("categoryId" in body) update.categoryId = body.categoryId ?? null;
  if ("subcategoryId" in body) update.subcategoryId = body.subcategoryId ?? null;
  if ("notes" in body) update.notes = body.notes ?? null;

  await db.update(transactions).set(update).where(eq(transactions.id, id));

  let backfillCount = 0;
  if ("categoryId" in body || "subcategoryId" in body) {
    const newCategoryId = (update.categoryId as number | null) ?? null;
    const newSubcategoryId = (update.subcategoryId as number | null) ?? null;
    await upsertRule(db, {
      description: txn.description,
      categoryId: newCategoryId,
      subcategoryId: newSubcategoryId,
    });
    // Apply the same categorization to any other UNCATEGORIZED transactions
    // whose normalized description matches — so labeling one Wise transfer
    // cascades through them all.
    if (newCategoryId !== null) {
      backfillCount = await backfillRule(db, {
        description: txn.description,
        categoryId: newCategoryId,
        subcategoryId: newSubcategoryId,
        excludeId: id,
      });
    }
  }

  const after = await db.select().from(transactions).where(eq(transactions.id, id)).limit(1);
  return c.json({ ...after[0], backfillCount });
});

// Bulk PATCH: apply the same category to many transactions in one call.
// Drives the drag-fill flow in the UI (next commit).
//   Body: { ids: number[], categoryId: number|null, subcategoryId?: number|null }
transactionsRoutes.patch("/", async (c) => {
  const body = await c.req.json().catch(() => ({})) as {
    ids?: number[];
    categoryId?: number | null;
    subcategoryId?: number | null;
  };
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return c.json({ error: "ids[] required" }, 400);
  }
  if (!("categoryId" in body)) {
    return c.json({ error: "categoryId required" }, 400);
  }
  const ids = body.ids.filter((n): n is number => Number.isInteger(n));
  const db = getDb();
  const nowIso = new Date().toISOString();

  let updated = 0;
  let backfillCount = 0;
  // We deliberately walk one row at a time so we can also (a) upsert the
  // rule from the FIRST row's description and (b) backfill matching
  // uncategorized rows. The per-row update cost is cheap on SQLite.
  let ruleUpserted = false;
  for (const id of ids) {
    const before = (await db.select().from(transactions).where(eq(transactions.id, id)).limit(1))[0];
    if (!before) continue;
    await db.update(transactions).set({
      categoryId: body.categoryId ?? null,
      subcategoryId: body.subcategoryId ?? null,
      updatedAt: nowIso,
    }).where(eq(transactions.id, id));
    updated++;
    // Learn from the first row only — subsequent rows in the same drag
    // typically share the description, so one rule covers them all.
    if (!ruleUpserted && body.categoryId !== null) {
      await upsertRule(db, {
        description: before.description,
        categoryId: body.categoryId ?? null,
        subcategoryId: body.subcategoryId ?? null,
      });
      backfillCount = await backfillRule(db, {
        description: before.description,
        categoryId: body.categoryId ?? null,
        subcategoryId: body.subcategoryId ?? null,
        excludeId: id,
      });
      ruleUpserted = true;
    }
  }
  return c.json({ updated, backfillCount });
});
