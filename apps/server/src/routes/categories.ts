import { Hono } from "hono";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "@moneycontrol/db";
import { categories, type NewCategory } from "@moneycontrol/db/schema";

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

// POST /categories  { name: string, parentId?: number, type?: 'expense'|'income'|'transfer' }
//   Creates a new top-level category (parentId null) or subcategory.
//   Type defaults to inheriting parent's type; falls back to 'expense'.
categoriesRoutes.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({})) as {
    name?: string;
    parentId?: number | null;
    type?: "expense" | "income" | "transfer";
  };
  const name = body.name?.trim();
  if (!name) return c.json({ error: "name is required" }, 400);

  const db = getDb();
  const parentId = body.parentId ?? null;

  // If a subcategory, inherit type from the parent unless overridden.
  let type: "expense" | "income" | "transfer" = body.type ?? "expense";
  if (parentId !== null) {
    const parent = (await db.select().from(categories).where(eq(categories.id, parentId)))[0];
    if (!parent) return c.json({ error: "parent not found" }, 404);
    type = body.type ?? parent.type;
  }

  // Avoid duplicates on (name, parent_id) since the unique index would error.
  const existing = await db
    .select()
    .from(categories)
    .where(parentId === null
      ? and(eq(categories.name, name), isNull(categories.parentId))
      : and(eq(categories.name, name), eq(categories.parentId, parentId)),
    );
  if (existing.length > 0) return c.json(existing[0]);

  const row: NewCategory = { name, parentId, type };
  const inserted = await db.insert(categories).values(row).returning();
  return c.json(inserted[0]);
});

// PATCH /categories/:id  { name?, type? }
//   Renames or re-types. Transactions/rules referencing this category stay
//   linked (FK by id, not by name).
categoriesRoutes.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
  const body = await c.req.json().catch(() => ({})) as {
    name?: string;
    type?: "expense" | "income" | "transfer";
  };

  const db = getDb();
  const cur = (await db.select().from(categories).where(eq(categories.id, id)))[0];
  if (!cur) return c.json({ error: "not found" }, 404);

  const update: Partial<NewCategory> = {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return c.json({ error: "name cannot be empty" }, 400);
    update.name = name;
  }
  if (body.type) update.type = body.type;
  if (Object.keys(update).length === 0) return c.json(cur);

  await db.update(categories).set(update).where(eq(categories.id, id));
  const after = (await db.select().from(categories).where(eq(categories.id, id)))[0];
  return c.json(after);
});

// DELETE /categories/:id
//   Removes the category. Transactions/rules referencing it have category_id
//   nulled out by the existing FK rule (`onDelete: set null`). For top-level
//   categories, child subcategories are also nulled — they become root-level
//   categories. Caller passes ?cascade=1 to also delete child rows.
categoriesRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
  const cascade = c.req.query("cascade") === "1";

  const db = getDb();
  if (cascade) {
    // Subcategories first (so the parent delete doesn't orphan them).
    await db.delete(categories).where(eq(categories.parentId, id));
  } else {
    // Promote child subcategories to standalone top-level categories.
    await db.update(categories).set({ parentId: null }).where(eq(categories.parentId, id));
  }
  await db.delete(categories).where(eq(categories.id, id));
  return c.json({ ok: true });
});
