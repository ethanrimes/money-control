import { Hono } from "hono";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb } from "@moneycontrol/db";
import { transactions, accounts, categories } from "@moneycontrol/db/schema";
import { upsertRule } from "../lib/categorize.js";

export const transactionsRoutes = new Hono();

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

  const cat = sql.raw("c1");
  const sub = sql.raw("c2");
  const rows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      description: transactions.description,
      amount: transactions.amount,
      accountId: transactions.accountId,
      accountName: accounts.name,
      categoryId: transactions.categoryId,
      categoryName: sql<string | null>`${cat}.name`,
      subcategoryId: transactions.subcategoryId,
      subcategoryName: sql<string | null>`${sub}.name`,
      source: transactions.source,
      notes: transactions.notes,
    })
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(sql`${categories} as c1`, sql`c1.id = ${transactions.categoryId}`)
    .leftJoin(sql`${categories} as c2`, sql`c2.id = ${transactions.subcategoryId}`)
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

  // If category changed, persist the learned mapping.
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
