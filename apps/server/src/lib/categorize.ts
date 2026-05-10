// Look up a categorization rule for a transaction description, then upsert
// the rule's hit-count for visibility. Used by both the sync path (Teller
// ingest) and the manual-create path.

import { and, eq, like, sql, desc } from "drizzle-orm";
import { categorizationRules, type NewCategorizationRule } from "@moneycontrol/db/schema";
import { normalizeDescription } from "@moneycontrol/core";
import type { getDb } from "@moneycontrol/db";

type Db = ReturnType<typeof getDb>;

export interface ResolvedCategory {
  categoryId: number | null;
  subcategoryId: number | null;
  ruleId: number | null;
}

export async function resolveCategory(db: Db, description: string): Promise<ResolvedCategory> {
  const key = normalizeDescription(description);
  if (!key) return { categoryId: null, subcategoryId: null, ruleId: null };

  // 1. Exact match wins.
  const exactHit = await db
    .select()
    .from(categorizationRules)
    .where(and(eq(categorizationRules.matchText, key), eq(categorizationRules.matchType, "exact")))
    .limit(1);
  if (exactHit.length > 0) {
    const r = exactHit[0]!;
    await touchRule(db, r.id);
    return { categoryId: r.categoryId, subcategoryId: r.subcategoryId, ruleId: r.id };
  }

  // 2. Otherwise: longest `contains` match (highest priority, longest matchText).
  const containsHits = await db
    .select()
    .from(categorizationRules)
    .where(
      and(
        eq(categorizationRules.matchType, "contains"),
        sql`instr(${sql.raw("'") }${sql.raw(escapeLiteral(key))}${sql.raw("'")}, ${categorizationRules.matchText}) > 0`,
      ),
    )
    .orderBy(desc(categorizationRules.priority), desc(sql`length(${categorizationRules.matchText})`));
  if (containsHits.length > 0) {
    const r = containsHits[0]!;
    await touchRule(db, r.id);
    return { categoryId: r.categoryId, subcategoryId: r.subcategoryId, ruleId: r.id };
  }

  return { categoryId: null, subcategoryId: null, ruleId: null };
}

async function touchRule(db: Db, ruleId: number): Promise<void> {
  await db
    .update(categorizationRules)
    .set({
      hits: sql`${categorizationRules.hits} + 1`,
      lastUsedAt: new Date().toISOString(),
    })
    .where(eq(categorizationRules.id, ruleId));
}

// Upsert a rule when a user manually re-categorizes a transaction. The next
// time a transaction with the same normalized description arrives, it'll
// auto-pick this category.
export async function upsertRule(
  db: Db,
  args: { description: string; categoryId: number | null; subcategoryId: number | null },
): Promise<void> {
  const matchText = normalizeDescription(args.description);
  if (!matchText) return;

  const existing = await db
    .select()
    .from(categorizationRules)
    .where(and(eq(categorizationRules.matchText, matchText), eq(categorizationRules.matchType, "exact")))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(categorizationRules)
      .set({ categoryId: args.categoryId, subcategoryId: args.subcategoryId })
      .where(eq(categorizationRules.id, existing[0]!.id));
    return;
  }

  const row: NewCategorizationRule = {
    matchText,
    matchType: "exact",
    categoryId: args.categoryId,
    subcategoryId: args.subcategoryId,
  };
  await db.insert(categorizationRules).values(row);
}

// Drizzle's sql.raw doesn't escape; we only feed it the normalized description
// (lowercase, alnum + few punctuation), but be defensive anyway.
function escapeLiteral(s: string): string {
  return s.replace(/'/g, "''");
}
