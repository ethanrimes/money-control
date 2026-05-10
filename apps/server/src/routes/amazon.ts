// Break out a single Amazon credit-card charge into per-item transactions.
//
// Why: when Teller syncs your Prime Visa, an Amazon order shows up as ONE
// $650.50 charge — useless for categorization (the order might mix groceries,
// electronics, household goods). This endpoint accepts a parsed Order Details
// PDF as structured JSON, deletes the single matching Amazon charge on the
// card, and replaces it with one transaction per item + tax + shipping +
// gift-card-used + points-used. Total still nets to the original grand total.
//
// POST /import/amazon-order
//   {
//     orderId: "112-...",
//     datePlaced: "2026-05-05",
//     cardLastFour: "8865",
//     items: [{ name, unitPrice, quantity }],
//     tax: 63.55,
//     shipping: 0,
//     giftCardAmount: 47.35,    // positive number that was credited
//     rewardsPoints: 0,         // positive number that was credited
//     grandTotal: 650.50
//   }

import { Hono } from "hono";
import { and, eq, gte, isNull, like, lte, sql } from "drizzle-orm";
import { getDb } from "@moneycontrol/db";
import { accounts, categories, transactions, type NewTransaction } from "@moneycontrol/db/schema";

export const amazonRoutes = new Hono();

interface AmazonItem {
  name: string;
  unitPrice: number;
  quantity: number;
}

interface AmazonCredit {
  label: string;   // shown in transaction description, e.g. "Gift Card Used"
  amount: number;  // positive number that was credited toward the order
}

interface AmazonOrderBody {
  orderId: string;
  datePlaced: string;            // ISO YYYY-MM-DD
  cardLastFour: string;
  items: AmazonItem[];
  tax?: number;
  shipping?: number;
  // New generic form. Older callers can still pass giftCardAmount /
  // rewardsPoints individually; both forms are merged into one credits list.
  credits?: AmazonCredit[];
  giftCardAmount?: number;
  rewardsPoints?: number;
  grandTotal: number;
}

amazonRoutes.post("/amazon-order", async (c) => {
  const body = await c.req.json().catch(() => ({})) as Partial<AmazonOrderBody>;

  if (
    !body.orderId
    || !body.datePlaced
    || !body.cardLastFour
    || !Array.isArray(body.items)
    || typeof body.grandTotal !== "number"
  ) {
    return c.json({ error: "orderId, datePlaced, cardLastFour, items, grandTotal are required" }, 400);
  }
  const tax = body.tax ?? 0;
  const shipping = body.shipping ?? 0;
  // Merge legacy named fields into the generic credits array.
  const credits: AmazonCredit[] = [...(body.credits ?? [])];
  if ((body.giftCardAmount ?? 0) > 0) credits.push({ label: "Gift Card Used", amount: body.giftCardAmount! });
  if ((body.rewardsPoints ?? 0) > 0) credits.push({ label: "Rewards Points Used", amount: body.rewardsPoints! });

  const db = getDb();
  const acct = (await db
    .select()
    .from(accounts)
    .where(eq(accounts.lastFour, body.cardLastFour))
    .limit(1))[0];
  if (!acct) {
    return c.json({ error: `no account with last_four=${body.cardLastFour}` }, 404);
  }

  // Idempotency: if any line item with this order tag already exists, skip
  // the whole import (caller can DELETE first with the cleanup endpoint to
  // re-run).
  const tag = `amazon-order:${body.orderId}`;
  const existingTagged = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.notes, tag))
    .limit(1);
  if (existingTagged.length > 0) {
    return c.json({ status: "already-imported", orderId: body.orderId });
  }

  // Find + delete the original aggregator-pulled Amazon charge. Match by:
  //   - same account (Prime Visa)
  //   - same total amount (-grandTotal)  ± $0.01
  //   - within ±10 days of order date
  //   - description containing AMAZON / AMZN (defensive — without it we'd
  //     match any random charge that happens to be the same amount)
  const fromDate = isoDateOffset(body.datePlaced, -10);
  const toDate = isoDateOffset(body.datePlaced, 10);
  const candidates = await db
    .select()
    .from(transactions)
    .where(and(
      eq(transactions.accountId, acct.id),
      gte(transactions.date, fromDate),
      lte(transactions.date, toDate),
      sql`abs(${transactions.amount} + ${body.grandTotal}) < 0.01`,
      // Hono+Drizzle param binding is safe; LIKE pattern is hand-coded.
      sql`(lower(${transactions.description}) LIKE '%amazon%' OR lower(${transactions.description}) LIKE '%amzn%')`,
    ))
    .limit(1);
  void like; // imported for any future use

  let deletedOriginal: { id: number; description: string } | null = null;
  if (candidates.length > 0) {
    const orig = candidates[0]!;
    deletedOriginal = { id: orig.id, description: orig.description };
    await db.delete(transactions).where(eq(transactions.id, orig.id));
  }

  // Credits on an Amazon order (gift card balance, rewards points,
  // Subscribe & Save, coupons) bucket into "Income / Income - Rebates":
  // the user treats these as income because they're real spending power
  // funded by something other than this month's cash. Create the
  // subcategory on-the-fly the first time we need it.
  const incomeParent = (await db
    .select()
    .from(categories)
    .where(and(eq(categories.type, "income"), isNull(categories.parentId)))
    .limit(1))[0];
  let rebatesCat = incomeParent
    ? (await db
        .select()
        .from(categories)
        .where(and(eq(categories.name, "Income - Rebates"), eq(categories.parentId, incomeParent.id)))
        .limit(1))[0]
    : undefined;
  if (!rebatesCat && incomeParent) {
    rebatesCat = (await db
      .insert(categories)
      .values({ name: "Income - Rebates", parentId: incomeParent.id, type: "income" })
      .returning())[0];
  }

  const inserts: NewTransaction[] = [];

  // Items
  for (const item of body.items) {
    const lineTotal = item.unitPrice * (item.quantity ?? 1);
    const qtyPrefix = (item.quantity ?? 1) > 1 ? `${item.quantity}× ` : "";
    inserts.push({
      accountId: acct.id,
      date: body.datePlaced,
      description: `Amazon — ${qtyPrefix}${item.name}`,
      rawDescription: item.name,
      amount: -roundCents(lineTotal),
      source: "manual",
      notes: tag,
    });
  }
  // Tax & shipping — separate line items so the user can categorize them
  // alongside the dominant items in the order.
  if (tax > 0) {
    inserts.push({
      accountId: acct.id,
      date: body.datePlaced,
      description: `Amazon — Tax`,
      rawDescription: `Amazon Tax`,
      amount: -roundCents(tax),
      source: "manual",
      notes: tag,
    });
  }
  if (shipping > 0) {
    inserts.push({
      accountId: acct.id,
      date: body.datePlaced,
      description: `Amazon — Shipping`,
      rawDescription: `Amazon Shipping`,
      amount: -roundCents(shipping),
      source: "manual",
      notes: tag,
    });
  }
  // Credits — gift card, rewards, Subscribe & Save, coupons. All positive.
  // Categorize as Income / Income - Rebates so they show up in the budget
  // tab as income alongside paychecks.
  for (const credit of credits) {
    if (!Number.isFinite(credit.amount) || credit.amount <= 0) continue;
    inserts.push({
      accountId: acct.id,
      date: body.datePlaced,
      description: `Amazon — ${credit.label}`,
      rawDescription: `Amazon ${credit.label}`,
      amount: roundCents(credit.amount),
      source: "manual",
      notes: tag,
      categoryId: incomeParent?.id ?? null,
      subcategoryId: rebatesCat?.id ?? null,
    });
  }

  for (const row of inserts) {
    await db.insert(transactions).values(row);
  }

  // Sanity: the line items should sum to -grandTotal. Drift indicates a
  // bug in the caller's math.
  const sumInserts = inserts.reduce((s, r) => s + (r.amount ?? 0), 0);
  const expected = -body.grandTotal;
  const drift = Math.abs(sumInserts - expected);

  return c.json({
    status: "imported",
    orderId: body.orderId,
    insertedCount: inserts.length,
    deletedOriginal,
    accountId: acct.id,
    sumCheck: { sumInserts: roundCents(sumInserts), expected: roundCents(expected), drift: roundCents(drift) },
  });
});

function isoDateOffset(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}
