import { Hono } from "hono";
import { asc } from "drizzle-orm";
import { getDb } from "@moneycontrol/db";
import { categories } from "@moneycontrol/db/schema";

export const categoriesRoutes = new Hono();

// Returns top-level categories with a nested `subcategories` array, so the
// dashboard can render a tree without N+1 queries.
categoriesRoutes.get("/", async (c) => {
  const db = getDb();
  const all = await db.select().from(categories).orderBy(asc(categories.name));
  const tops = all.filter((r) => r.parentId === null);
  const children = all.filter((r) => r.parentId !== null);
  const tree = tops.map((t) => ({
    ...t,
    subcategories: children.filter((s) => s.parentId === t.id),
  }));
  return c.json(tree);
});
