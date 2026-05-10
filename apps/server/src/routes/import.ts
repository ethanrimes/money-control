// Bulk CSV import for transactions.
//
// POST /import/csv  { accountId, csv, tag? }
//   Parses a 3-column CSV (date, description, amount), inserts each row as a
//   transaction on `accountId`. Each row is run through resolveCategory()
//   first, so any matching learned rules apply automatically. Duplicates
//   (same accountId + date + description + amount) are skipped so re-running
//   the same file is safe.
//
//   If `tag` is provided, every inserted row gets `notes = tag`. Use this to
//   mark imports that may need cleanup later (e.g. CSV import as a stopgap
//   for an account Plaid will eventually link).
//
// DELETE /import/csv?tag=...
//   Deletes every transaction whose notes column starts with the given tag
//   prefix. Used to undo a tagged batch (e.g. after Plaid finally links the
//   account that was being CSV-imported).

import { Hono } from "hono";
import { and, eq, like, sql } from "drizzle-orm";
import { getDb } from "@moneycontrol/db";
import { accounts, transactions, type NewTransaction } from "@moneycontrol/db/schema";
import { resolveCategoryWithHeuristics } from "../lib/categorize.js";

export const importRoutes = new Hono();

importRoutes.post("/csv", async (c) => {
  const body = await c.req.json().catch(() => ({})) as {
    accountId?: number;
    csv?: string;
    tag?: string | null;
  };
  if (typeof body.accountId !== "number" || typeof body.csv !== "string") {
    return c.json({ error: "accountId (number) and csv (string) are required" }, 400);
  }

  const db = getDb();
  const acct = (await db.select().from(accounts).where(eq(accounts.id, body.accountId)))[0];
  if (!acct) return c.json({ error: "account not found" }, 404);

  const rows = parseCsv(body.csv);
  const tag = body.tag?.trim() || null;

  let inserted = 0;
  let skipped = 0;
  let errors: Array<{ row: number; reason: string }> = [];

  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx]!;
    if (row.length === 0 || (row.length === 1 && row[0]!.trim() === "")) continue;
    if (row.length < 3) {
      errors.push({ row: idx + 1, reason: `expected 3 fields, got ${row.length}` });
      continue;
    }
    const date = normalizeDate(row[0]!.trim());
    const description = row[1]!.trim();
    const amount = parseAmount(row[2]!.trim());
    if (!date) { errors.push({ row: idx + 1, reason: `bad date: ${row[0]}` }); continue; }
    if (!description) { errors.push({ row: idx + 1, reason: "empty description" }); continue; }
    if (amount === null) { errors.push({ row: idx + 1, reason: `bad amount: ${row[2]}` }); continue; }

    // Dedup: same account+date+description+amount = already imported.
    const dup = await db.select({ id: transactions.id })
      .from(transactions)
      .where(and(
        eq(transactions.accountId, body.accountId),
        eq(transactions.date, date),
        eq(transactions.description, description),
        eq(transactions.amount, amount),
      ))
      .limit(1);
    if (dup.length > 0) { skipped++; continue; }

    const { categoryId, subcategoryId } = await resolveCategoryWithHeuristics(db, description);
    const newRow: NewTransaction = {
      accountId: body.accountId,
      date,
      description,
      rawDescription: description,
      amount,
      categoryId,
      subcategoryId,
      source: "manual",
      notes: tag,
    };
    await db.insert(transactions).values(newRow);
    inserted++;
  }

  return c.json({ inserted, skipped, errors });
});

importRoutes.delete("/csv", async (c) => {
  const tag = c.req.query("tag");
  if (!tag) return c.json({ error: "tag query parameter required" }, 400);
  const db = getDb();
  // SQL injection: `like` parameterizes the value, but `%` is part of the
  // pattern we control. tag itself flows through bound params, safe.
  const pattern = `${tag}%`;
  const matched = await db.select({ id: transactions.id })
    .from(transactions)
    .where(like(transactions.notes, pattern));
  if (matched.length === 0) return c.json({ deleted: 0 });
  await db.delete(transactions).where(like(transactions.notes, pattern));
  return c.json({ deleted: matched.length });
});

// ----- helpers -----

// Tiny RFC-4180-ish CSV parser. Handles quoted fields, quoted commas, doubled
// quotes inside fields, and \r\n / \r / \n line endings. We don't use a
// library to keep the dependency surface small for a feature this simple.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const row: string[] = [];
    while (i < n && text[i] !== "\n" && text[i] !== "\r") {
      let field = "";
      if (text[i] === "\"") {
        i++;
        while (i < n) {
          if (text[i] === "\"" && text[i + 1] === "\"") { field += "\""; i += 2; }
          else if (text[i] === "\"") { i++; break; }
          else { field += text[i++]; }
        }
      } else {
        while (i < n && text[i] !== "," && text[i] !== "\n" && text[i] !== "\r") {
          field += text[i++];
        }
      }
      row.push(field);
      if (text[i] === ",") i++;
    }
    while (i < n && (text[i] === "\n" || text[i] === "\r")) i++;
    if (row.length > 0) rows.push(row);
  }
  return rows;
}

// Accept either YYYY-MM-DD (preferred) or MM/DD/YYYY (Amex/BofA exports).
function normalizeDate(s: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const [, mm, dd, yyyy] = m;
    return `${yyyy}-${mm!.padStart(2, "0")}-${dd!.padStart(2, "0")}`;
  }
  return null;
}

function parseAmount(s: string): number | null {
  // Strip $ and , then parse.
  const cleaned = s.replace(/[$,]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Suppress an unused-import warning if anyone refactors the schema imports
// without removing sql/like — these are real deps even though TS can be picky.
void sql;
