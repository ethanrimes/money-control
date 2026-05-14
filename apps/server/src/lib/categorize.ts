// Look up a categorization rule for a transaction description, then upsert
// the rule's hit-count for visibility. Used by both the sync path (Teller
// ingest) and the manual-create path.

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { categories, categorizationRules, transactions, type NewCategorizationRule } from "@moneycontrol/db/schema";
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
      lastUsedAt: new Date(),
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

// Description patterns that are almost-always inter-account transfers or
// credit-card payments. When the user hasn't yet built a rule, we still want
// these out of the spend total — they aren't consumption. Keep this list
// conservative: only descriptions that are unambiguous payment/transfer
// strings across the major US banks.
const TRANSFER_PATTERNS: RegExp[] = [
  /^internet transfer/i,                      // BofA / Chase web transfers
  /\bzelle\b/i,                                // Zelle = peer-to-peer (often friends, sometimes transfers)
  /\bvenmo\b.*\b(payment|cashout|withdrawal)\b/i,
  /\bwise\b.*(?:trnwise|wise\s+\d|us\s+inc)/i, // Wise outgoing transfers
  /^bilt payment/i,                            // Bilt = rent — NOT a transfer; we exclude this pattern below
  /amex epayment/i,                            // Amex bill payment from bank
  /american\s*express\s+des:(?:transfer|ach\s*pmt)/i,
  /^americanexpress\s+des:transfer/i,
  /capital\s*one.*(?:mobile\s+)?(?:pymt|pmt|pyment|payment)/i,
  /^online\s*payment\s*-\s*thank\s*you/i,      // Common credit card payment ack
  /^mobile\s*payment\s*-\s*thank\s*you/i,
  /^fid\s*bkg\s*svc\b/i,                       // Fidelity ACH transfer
  /^chase\s+credit\s+crd/i,                    // Chase credit card payment
  /^one-time\s+deposit/i,                      // Amex HYSA "One-Time Deposit"
];
// Exception patterns: matches a transfer-looking string that is in fact NOT a
// transfer. Checked first so we don't mis-categorize them.
const NOT_TRANSFER_PATTERNS: RegExp[] = [
  /^bilt payment.*biltrent/i,                  // Bilt rent payment IS rent
];

function looksLikeTransfer(description: string): boolean {
  if (NOT_TRANSFER_PATTERNS.some((p) => p.test(description))) return false;
  return TRANSFER_PATTERNS.some((p) => p.test(description));
}

// Merchant-keyword → (category, subcategory) heuristic table. Hand-curated
// against the user's actual bank-statement vocabulary. Order matters —
// first match wins. The categorize-with-heuristics pass uses this after
// learned rules and substring matching have already missed.
//
// Cheat-sheet for the prefixes:
//   AplPay  = Apple Pay; the merchant follows
//   TST*    = Toast POS — restaurants
//   SQ *    = Square POS — anything
//   BT*DD   = DoorDash
//   IC*     = Instacart
//   CPI*    = vending-machine processor (Canteen)
const MERCHANT_PATTERNS: Array<{ pattern: RegExp; categoryName: string; subcategoryName?: string }> = [
  // ---- Dining / Restaurants ----
  // Toast POS through Apple Pay is almost always a sit-down restaurant.
  { pattern: /aplpay\s+tst\*/i, categoryName: "Food & Maintenance", subcategoryName: "Dining" },
  { pattern: /\bsq\s*\*\s/i, categoryName: "Food & Maintenance", subcategoryName: "Dining" },
  // DoorDash (sometimes shows as "BT*DD *DOORDASH")
  { pattern: /\bdoordash\b|bt\*dd\b/i, categoryName: "Food & Maintenance", subcategoryName: "Dining" },
  // Microsoft campus cafes & vending (user works at MS)
  { pattern: /aplpay\s+(ms\s+ca|ms\s+cm|ms\s+mill|mscafe|soupson|jacks\s+bb|tous\s+les\s+jou|pho\s+bac|salt\s+and|edgewate|hood\s+fam|rhein\s+ha|dordlofv|culturemap)/i, categoryName: "Food & Maintenance", subcategoryName: "Dining" },
  { pattern: /\bcanteen\b|cpi\*\s*canteen|ctlp\*\s*volume/i, categoryName: "Food & Maintenance", subcategoryName: "Dining" },
  { pattern: /aplpay\s+coca-?cola/i, categoryName: "Food & Maintenance", subcategoryName: "Dining" },

  // ---- Groceries ----
  { pattern: /\binstacart\b|^ic\*|aplpay\s+ic\*/i, categoryName: "Food & Maintenance", subcategoryName: "Groceries" },
  { pattern: /aplpay\s+jumbo\b/i, categoryName: "Food & Maintenance", subcategoryName: "Groceries" },
  { pattern: /\bwholefds\b|\bwhole\s+foods\b/i, categoryName: "Food & Maintenance", subcategoryName: "Groceries" },
  { pattern: /\btrader\s+joe/i, categoryName: "Food & Maintenance", subcategoryName: "Groceries" },
  { pattern: /\bsafeway\b/i, categoryName: "Food & Maintenance", subcategoryName: "Groceries" },

  // ---- Rideshare ----
  { pattern: /\buber\b.*\btrip|uber\.com/i, categoryName: "Transportation", subcategoryName: "Transportation (Rideshare)" },
  { pattern: /\blyft\b/i, categoryName: "Transportation", subcategoryName: "Transportation (Rideshare)" },

  // ---- Travel: airlines, in-flight wifi, duty-free, international shops,
  //              ATM withdrawals abroad, etc. ----
  { pattern: /alaska\s+air|aplpay\s+alaska\s+air/i, categoryName: "Travel" },
  { pattern: /frontier\s+air/i, categoryName: "Travel" },
  { pattern: /wifionboard/i, categoryName: "Travel" },
  { pattern: /\b(dufry|jetpac)/i, categoryName: "Travel" },
  { pattern: /\bbogota\b|b\.bog\b|bogot\b|\bcolombia\b|\bsingapore\b/i, categoryName: "Travel" },
  { pattern: /\bath\b.*withdrwl|withdrwl.*\bath\b/i, categoryName: "Travel" },
  { pattern: /\bbay\s+area.*\bga\b|toll\s+plaza|fastrak/i, categoryName: "Travel" },

  // ---- Rent ----
  { pattern: /hollandpartner|^bilt\s+(payment|rent)|biltrent/i, categoryName: "Rent & Utilities", subcategoryName: "Rent" },

  // ---- Subscriptions / software / online services ----
  { pattern: /^facebk\b|^facebook\b|\bfb\.me\b/i, categoryName: "Subscriptions", subcategoryName: "Subscriptions / Software" },
  { pattern: /\bx\s+corp\.?\s+paid|\bx\s+premium\b|^twitter\b/i, categoryName: "Subscriptions", subcategoryName: "Subscriptions / Software" },
  { pattern: /\bopenai\b|\banthropic\b|github\.com|^claude\b|^cursor\b/i, categoryName: "Subscriptions", subcategoryName: "Subscriptions / Software" },

  // ---- Income (affiliate / referral) ----
  { pattern: /^impact\s+radius|\baffiliate\b|\breferral\s+payout/i, categoryName: "Income", subcategoryName: "Income - Salary" },
  // BofA mobile-deposit (depositing a check) — usually checks from outside
  // sources, treat as Income - Transfer so it doesn't double-count as new income.
  { pattern: /\bbkofamerica\s+mobile\b.*\bdeposit\b/i, categoryName: "Income", subcategoryName: "Income - Transfer" },

  // ---- Amazon catch-alls (after PDF imports break out specific items) ----
  // Tax line items from Amazon order imports — bucket as a known
  // subcategory the user already had ("Amazon Tax/Shipping").
  { pattern: /^amazon\s+—\s+tax\b/i, categoryName: "Durable Goods", subcategoryName: "Amazon Tax/Shipping" },
  { pattern: /^amazon\s+—\s+shipping\b/i, categoryName: "Durable Goods", subcategoryName: "Amazon Tax/Shipping" },
  // Generic "Amazon — <item>" fallback — Durable Goods is the safe bucket
  // for an unspecified Amazon purchase. User can re-categorize specific
  // ones in the UI (Electronics, Groceries, Household Goods, etc.).
  { pattern: /^amazon\s+—\s+/i, categoryName: "Durable Goods", subcategoryName: "Household Goods" },
];

async function lookupCategoryByName(
  db: Db,
  categoryName: string,
  subcategoryName?: string,
): Promise<{ categoryId: number | null; subcategoryId: number | null }> {
  const { categories } = await import("@moneycontrol/db/schema");
  const parent = (await db
    .select()
    .from(categories)
    .where(and(eq(categories.name, categoryName), isNull(categories.parentId)))
    .limit(1))[0];
  if (!parent) return { categoryId: null, subcategoryId: null };
  if (!subcategoryName) return { categoryId: parent.id, subcategoryId: null };
  const sub = (await db
    .select()
    .from(categories)
    .where(and(eq(categories.name, subcategoryName), eq(categories.parentId, parent.id)))
    .limit(1))[0];
  return { categoryId: parent.id, subcategoryId: sub?.id ?? null };
}

// Wrapper used by every ingest path (Teller sync, Plaid sync, CSV import).
// Resolution order:
//   1. Learned rules (exact normalized-description match)
//   2. Static transfer-pattern heuristic
//   3. Curated merchant-keyword patterns (MERCHANT_PATTERNS above)
export async function resolveCategoryWithHeuristics(
  db: Db,
  description: string,
): Promise<ResolvedCategory> {
  const ruleHit = await resolveCategory(db, description);
  if (ruleHit.categoryId !== null) return ruleHit;

  // Transfer patterns — prefer routing into "Card payment/account transfer"
  // subcategory (if the user has set it up); fall back to the top-level
  // transfer category for older DBs where the sub doesn't exist yet.
  if (looksLikeTransfer(description)) {
    const cardSub = (await db
      .select()
      .from(categories)
      .where(eq(categories.name, "Card payment/account transfer"))
      .limit(1))[0];
    if (cardSub) {
      return { categoryId: cardSub.parentId, subcategoryId: cardSub.id, ruleId: null };
    }
    const transferCat = (await db
      .select()
      .from(categories)
      .where(and(eq(categories.type, "transfer"), isNull(categories.parentId)))
      .limit(1))[0];
    if (transferCat) return { categoryId: transferCat.id, subcategoryId: null, ruleId: null };
  }

  // Merchant-keyword patterns
  for (const m of MERCHANT_PATTERNS) {
    if (m.pattern.test(description)) {
      const { categoryId, subcategoryId } = await lookupCategoryByName(db, m.categoryName, m.subcategoryName);
      if (categoryId !== null) return { categoryId, subcategoryId, ruleId: null };
    }
  }

  return ruleHit;
}

// Apply (categoryId, subcategoryId) to every UNCATEGORIZED transaction whose
// normalized description matches `description`'s normalized form. Returns the
// number of rows touched. Skips `excludeId` so the caller's just-updated row
// isn't double-counted.
//
// Called from PATCH /transactions/:id — if the user re-labels one Wise
// transfer, every other uncategorized Wise transfer auto-labels too.
//
// NOTE: we filter candidates by `categoryId IS NULL` in SQL (cheap), but the
// normalized-description match happens in JS — descriptions aren't stored
// normalized, and computing the same regex on every row in SQLite would
// require a UDF. For a personal-finance DB this is comfortably fast.
export async function backfillRule(
  db: Db,
  args: {
    description: string;
    categoryId: number | null;
    subcategoryId: number | null;
    excludeId: number;
  },
): Promise<number> {
  const key = normalizeDescription(args.description);
  if (!key) return 0;

  const candidates = await db
    .select({ id: transactions.id, description: transactions.description })
    .from(transactions)
    .where(isNull(transactions.categoryId));

  const matches = candidates.filter(
    (t) => t.id !== args.excludeId && normalizeDescription(t.description) === key,
  );
  if (matches.length === 0) return 0;

  const nowIso = new Date();
  for (const m of matches) {
    await db
      .update(transactions)
      .set({
        categoryId: args.categoryId,
        subcategoryId: args.subcategoryId,
        updatedAt: nowIso,
      })
      .where(eq(transactions.id, m.id));
  }
  return matches.length;
}
