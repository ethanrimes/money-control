import { Hono } from "hono";
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@moneycontrol/db";
import { accounts, balances, type NewAccount } from "@moneycontrol/db/schema";

export const accountsRoutes = new Hono();

// POST /accounts — create a manual account (no aggregator backing). Used for
// (a) Amex deposit accounts while Plaid OAuth approval is pending and (b)
// any account a user wants to track without ever linking (cash, foreign
// banks, brokerages Plaid doesn't cover).
accountsRoutes.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({})) as {
    name?: string;
    type?: "depository" | "credit";
    institution?: string | null;
    lastFour?: string | null;
    subtype?: string | null;
  };
  const name = body.name?.trim();
  if (!name) return c.json({ error: "name is required" }, 400);
  if (body.type !== "depository" && body.type !== "credit") {
    return c.json({ error: "type must be 'depository' or 'credit'" }, 400);
  }

  const db = getDb();
  const existing = await db.select().from(accounts).where(eq(accounts.name, name));
  if (existing.length > 0) {
    // Idempotent: the unique-name index would error otherwise, and re-creating
    // a duplicate isn't useful anyway.
    return c.json(existing[0]);
  }
  const row: NewAccount = {
    name,
    type: body.type,
    institution: body.institution ?? null,
    lastFour: body.lastFour ?? null,
    subtype: body.subtype ?? null,
  };
  const inserted = await db.insert(accounts).values(row).returning();
  return c.json(inserted[0]);
});

accountsRoutes.get("/", async (c) => {
  const db = getDb();
  // Latest balance per account via correlated subquery.
  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      institution: accounts.institution,
      lastFour: accounts.lastFour,
      tellerAccountId: accounts.tellerAccountId,
      latestBalance: sql<number | null>`(
        SELECT current FROM ${balances}
        WHERE ${balances.accountId} = ${accounts.id}
        ORDER BY ${balances.asOfDate} DESC LIMIT 1
      )`,
      latestBalanceDate: sql<string | null>`(
        SELECT as_of_date FROM ${balances}
        WHERE ${balances.accountId} = ${accounts.id}
        ORDER BY ${balances.asOfDate} DESC LIMIT 1
      )`,
    })
    .from(accounts)
    .orderBy(accounts.name);
  return c.json(rows);
});

accountsRoutes.get("/:id/balances", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
  const db = getDb();
  const rows = await db
    .select()
    .from(balances)
    .where(eq(balances.accountId, id))
    .orderBy(desc(balances.asOfDate));
  return c.json(rows);
});
