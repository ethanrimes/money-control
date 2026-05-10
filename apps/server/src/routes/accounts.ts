import { Hono } from "hono";
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@moneycontrol/db";
import { accounts, balances } from "@moneycontrol/db/schema";

export const accountsRoutes = new Hono();

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
