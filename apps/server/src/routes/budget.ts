import { Hono } from "hono";
import { desc } from "drizzle-orm";
import { getDb } from "@moneycontrol/db";
import { budgetSettings } from "@moneycontrol/db/schema";

export const budgetRoutes = new Hono();

budgetRoutes.get("/", async (c) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(budgetSettings)
    .orderBy(desc(budgetSettings.effectiveFrom))
    .limit(1);
  return c.json(rows[0] ?? null);
});

// PUT /budget  { monthlySavingsTarget: number, effectiveFrom?: 'YYYY-MM-DD' }
budgetRoutes.put("/", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    monthlySavingsTarget?: number;
    effectiveFrom?: string;
  };
  const target = Number(body.monthlySavingsTarget);
  if (!Number.isFinite(target) || target < 0) {
    return c.json({ error: "monthlySavingsTarget must be a non-negative number" }, 400);
  }
  const effectiveFrom = body.effectiveFrom ?? new Date().toISOString().slice(0, 10);
  const db = getDb();
  const inserted = await db
    .insert(budgetSettings)
    .values({ monthlySavingsTarget: target, effectiveFrom })
    .returning();
  return c.json(inserted[0]);
});
