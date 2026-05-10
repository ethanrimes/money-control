import { Hono } from "hono";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { getDb } from "@moneycontrol/db";
import { transactions, accounts, categories } from "@moneycontrol/db/schema";
import { upsertRule } from "../lib/categorize.js";

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

  if ("categoryId" in body || "subcategoryId" in body) {
    await upsertRule(db, {
      description: txn.description,
      categoryId: (update.categoryId as number | null) ?? null,
      subcategoryId: (update.subcategoryId as number | null) ?? null,
    });
  }

  const after = await db.select().from(transactions).where(eq(transactions.id, id)).limit(1);
  return c.json(after[0]);
});
