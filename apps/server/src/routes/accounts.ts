import { Hono } from "hono";
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@moneycontrol/db";
import { accounts, balances, type NewAccount } from "@moneycontrol/db/schema";

export const accountsRoutes = new Hono();

// POST /accounts — create a manual account (no aggregator backing). Used for
// (a) Amex deposit accounts while Plaid OAuth approval is pending and (b)
// any account a user wants to track without ever linking (cash, foreign
// banks, brokerages Plaid doesn't cover).
//
// Optionally accepts `currentBalance`: if provided, inserts a balance row
// dated today so the dashboard shows a real number immediately. For credit
// accounts, currentBalance is the amount owed (positive number = debt).
accountsRoutes.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({})) as {
    name?: string;
    type?: "depository" | "credit";
    institution?: string | null;
    lastFour?: string | null;
    subtype?: string | null;
    currentBalance?: number | null;
  };
  const name = body.name?.trim();
  if (!name) return c.json({ error: "name is required" }, 400);
  if (body.type !== "depository" && body.type !== "credit") {
    return c.json({ error: "type must be 'depository' or 'credit'" }, 400);
  }

  const db = getDb();
  const existing = await db.select().from(accounts).where(eq(accounts.name, name));
  let acct = existing[0];
  if (!acct) {
    const row: NewAccount = {
      name,
      type: body.type,
      institution: body.institution ?? null,
      lastFour: body.lastFour ?? null,
      subtype: body.subtype ?? null,
    };
    acct = (await db.insert(accounts).values(row).returning())[0];
  }
  // Idempotent balance set if requested.
  if (typeof body.currentBalance === "number" && Number.isFinite(body.currentBalance)) {
    await upsertTodayBalance(acct!.id, body.currentBalance);
  }
  return c.json(acct);
});

// PATCH /accounts/:id/balance  { current: number, available?: number }
//   Sets today's balance for an account. Used by the UI's "Edit balance"
//   action on manual accounts (and on aggregator-linked accounts if the
//   user wants to override a stale pulled balance).
accountsRoutes.patch("/:id/balance", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
  const body = await c.req.json().catch(() => ({})) as { current?: number; available?: number | null };
  if (typeof body.current !== "number" || !Number.isFinite(body.current)) {
    return c.json({ error: "current (number) is required" }, 400);
  }
  const db = getDb();
  const acct = (await db.select().from(accounts).where(eq(accounts.id, id)))[0];
  if (!acct) return c.json({ error: "account not found" }, 404);
  await upsertTodayBalance(id, body.current, body.available ?? null);
  return c.json({ ok: true });
});

async function upsertTodayBalance(accountId: number, current: number, available: number | null = null) {
  const db = getDb();
  const todayIso = new Date().toISOString().slice(0, 10);
  await db.insert(balances)
    .values({ accountId, asOfDate: todayIso, current, available })
    .onConflictDoUpdate({
      target: [balances.accountId, balances.asOfDate],
      set: { current, available },
    });
}

accountsRoutes.get("/", async (c) => {
  const db = getDb();
  // Latest balance per account via correlated subquery. Drizzle's sql
  // template doesn't auto-prefix columns from the outer scope, so we
  // hand-write the qualified names — otherwise SQLite resolves the bare
  // "id" to balances.id (inner scope) and the subquery never matches.
  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      institution: accounts.institution,
      lastFour: accounts.lastFour,
      tellerAccountId: accounts.tellerAccountId,
      latestBalance: sql<number | null>`(
        SELECT b.current FROM balances b
        WHERE b.account_id = accounts.id
        ORDER BY b.as_of_date DESC LIMIT 1
      )`,
      latestBalanceDate: sql<string | null>`(
        SELECT b.as_of_date FROM balances b
        WHERE b.account_id = accounts.id
        ORDER BY b.as_of_date DESC LIMIT 1
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
