// Seed the local SQLite DB from unified_statements_v2.xlsx.
//
// What this script does:
//   1. Read the Transactions sheet (Date, Account, Source File, Description,
//      Category, Subcategory, Amount).
//   2. Upsert distinct accounts (Amex/BofA/Capital One -> credit/depository).
//   3. Upsert top-level categories and their subcategories (parent_id link).
//   4. Insert every transaction row.
//   5. Build categorization_rules: one rule per distinct normalized description
//      mapping to the (category, subcategory) it was assigned. Future Teller
//      pulls will look these up by description match.
//
// Idempotent: deletes existing rows from the seeded tables before inserting,
// so re-running gives a clean slate. Manually-added rows (source = 'manual'
// or 'teller') are left alone.

import ExcelJS from "exceljs";
import path from "node:path";
import { eq, and, isNull } from "drizzle-orm";
import { getDb, getRawSqlite } from "../src/client.js";
import {
  accounts,
  categories,
  transactions,
  categorizationRules,
} from "../src/schema.js";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
// xlsx lives in csv/ (moved there alongside the bank CSV exports). Falls
// back to the repo root for legacy callers.
import fs from "node:fs";
const xlsxCandidates = [
  path.join(repoRoot, "csv", "unified_statements_v2.xlsx"),
  path.join(repoRoot, "unified_statements_v2.xlsx"),
];
const xlsxPath = xlsxCandidates.find((p) => fs.existsSync(p)) ?? xlsxCandidates[0];

const ACCOUNT_TYPES: Record<string, "credit" | "depository"> = {
  "Amex": "credit",
  "Capital One": "credit",
  "BofA Checking": "depository",
};

// Income categories are credits, transfers are between accounts; everything
// else is treated as expense for budgeting purposes.
function categoryType(name: string): "expense" | "income" | "transfer" {
  const n = name.toLowerCase();
  if (n.includes("income")) return "income";
  if (n.includes("transfer")) return "transfer";
  return "expense";
}

// Excel stores dates either as Date objects (when cells are date-typed) or as
// "MM/DD/YYYY" strings. Normalize both to ISO YYYY-MM-DD.
function toIsoDate(v: unknown): string {
  if (v instanceof Date) {
    const yyyy = v.getUTCFullYear();
    const mm = String(v.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(v.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  if (typeof v === "string") {
    const m = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) {
      const [, mm, dd, yyyy] = m;
      return `${yyyy}-${mm!.padStart(2, "0")}-${dd!.padStart(2, "0")}`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  }
  throw new Error(`unrecognized date value: ${JSON.stringify(v)}`);
}

function cellString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  // exceljs may return rich text or formula objects.
  if (typeof v === "object" && v !== null && "richText" in v) {
    return (v as { richText: Array<{ text: string }> }).richText.map((r) => r.text).join("");
  }
  if (typeof v === "object" && v !== null && "result" in v) {
    return String((v as { result: unknown }).result ?? "");
  }
  if (typeof v === "object" && v !== null && "text" in v) {
    return String((v as { text: unknown }).text ?? "");
  }
  return String(v);
}

function cellNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[$,]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  if (typeof v === "object" && v !== null && "result" in v) {
    const r = (v as { result: unknown }).result;
    if (typeof r === "number") return r;
  }
  throw new Error(`unrecognized number value: ${JSON.stringify(v)}`);
}

// Normalization mirrors packages/core/src/normalize.ts. Duplicated here to
// avoid pulling the core package into the seed script's dep graph.
function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[*#]+\s*\w+/g, "")
    .replace(/\b\d{6,}\b/g, "")
    .replace(/[^a-z0-9 ./&-]/g, "")
    .trim();
}

interface Row {
  date: string;
  account: string;
  sourceFile: string;
  description: string;
  category: string;
  subcategory: string;
  amount: number;
}

async function readRows(): Promise<Row[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);
  const sheet = wb.getWorksheet("Transactions");
  if (!sheet) throw new Error("Transactions sheet not found");

  const rows: Row[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const get = (i: number) => row.getCell(i).value;
    try {
      const r: Row = {
        date: toIsoDate(get(1)),
        account: cellString(get(2)).trim(),
        sourceFile: cellString(get(3)).trim(),
        description: cellString(get(4)).trim(),
        category: cellString(get(5)).trim(),
        subcategory: cellString(get(6)).trim(),
        amount: cellNumber(get(7)),
      };
      if (!r.account || !r.description) return;
      rows.push(r);
    } catch (err) {
      console.warn(`row ${rowNumber} skipped: ${(err as Error).message}`);
    }
  });
  return rows;
}

async function main() {
  console.log(`reading ${xlsxPath}`);
  const rows = await readRows();
  console.log(`parsed ${rows.length} transactions`);

  const db = getDb();
  const sqlite = getRawSqlite();

  console.log("clearing seeded data (excel-sourced rows + categorization rules)");
  sqlite.exec("BEGIN");
  try {
    sqlite.exec("DELETE FROM categorization_rules");
    sqlite.exec("DELETE FROM transactions WHERE source = 'excel'");
    // Accounts and categories are referenced by potential future manual/teller
    // rows, so we upsert by name rather than wholesale clearing them.
    sqlite.exec("COMMIT");
  } catch (e) {
    sqlite.exec("ROLLBACK");
    throw e;
  }

  // Accounts.
  const accountIdByName = new Map<string, number>();
  const distinctAccounts = [...new Set(rows.map((r) => r.account))];
  for (const name of distinctAccounts) {
    const type = ACCOUNT_TYPES[name] ?? "depository";
    const existing = await db.select().from(accounts).where(eq(accounts.name, name));
    if (existing.length > 0) {
      accountIdByName.set(name, existing[0]!.id);
      continue;
    }
    const inserted = await db.insert(accounts).values({ name, type }).returning({ id: accounts.id });
    accountIdByName.set(name, inserted[0]!.id);
  }
  console.log(`accounts: ${accountIdByName.size}`);

  // Categories: top-level then subcategory rows. "#N/A" or empty = uncategorized.
  const topLevelIds = new Map<string, number>();
  const subIds = new Map<string, number>(); // key = "Top|Sub"
  const distinctTops = [...new Set(rows.map((r) => r.category).filter((c) => c && c !== "#N/A"))];
  for (const top of distinctTops) {
    const existing = await db.select().from(categories)
      .where(and(eq(categories.name, top), isNull(categories.parentId)));
    if (existing.length > 0) {
      topLevelIds.set(top, existing[0]!.id);
      continue;
    }
    const inserted = await db.insert(categories).values({
      name: top,
      parentId: null,
      type: categoryType(top),
    }).returning({ id: categories.id });
    topLevelIds.set(top, inserted[0]!.id);
  }
  for (const r of rows) {
    if (!r.subcategory || r.subcategory === "#N/A") continue;
    if (!r.category || r.category === "#N/A") continue;
    const key = `${r.category}|${r.subcategory}`;
    if (subIds.has(key)) continue;
    const parentId = topLevelIds.get(r.category)!;
    const existing = await db.select().from(categories)
      .where(and(eq(categories.name, r.subcategory), eq(categories.parentId, parentId)));
    if (existing.length > 0) {
      subIds.set(key, existing[0]!.id);
      continue;
    }
    const inserted = await db.insert(categories).values({
      name: r.subcategory,
      parentId,
      type: categoryType(r.category),
    }).returning({ id: categories.id });
    subIds.set(key, inserted[0]!.id);
  }
  console.log(`categories: ${topLevelIds.size} top-level + ${subIds.size} subcategories`);

  // Transactions: insert ONLY Amazon line-item rows. Everything else in the
  // xlsx (subscriptions, dining, transfers, etc.) duplicates what Teller and
  // Plaid pull from the real accounts, and we don't want those rows
  // double-counted. The Amazon line items are the exception: the xlsx is
  // the canonical source for per-item Amazon breakdowns, since Teller only
  // sees one aggregate charge per order.
  //
  // The categorization-rule build below still uses ALL 452 rows — the
  // rules are derived from descriptions, not transactions, and we want
  // every learned mapping (Apple.com bill -> Subscriptions, etc.) to
  // remain available for auto-categorizing aggregator pulls.
  const AMAZON_PREFIX = "Amazon — "; // "Amazon — " with U+2014 em-dash
  let inserted = 0;
  let skipped = 0;
  for (const r of rows) {
    if (!r.description.startsWith(AMAZON_PREFIX)) {
      skipped++;
      continue;
    }
    const accountId = accountIdByName.get(r.account)!;
    const categoryId = (r.category && r.category !== "#N/A")
      ? topLevelIds.get(r.category) ?? null
      : null;
    const subcategoryId = (r.subcategory && r.subcategory !== "#N/A" && r.category && r.category !== "#N/A")
      ? subIds.get(`${r.category}|${r.subcategory}`) ?? null
      : null;
    await db.insert(transactions).values({
      accountId,
      date: r.date,
      description: r.description,
      rawDescription: r.description,
      amount: r.amount,
      categoryId,
      subcategoryId,
      source: "excel",
      sourceFile: r.sourceFile || null,
    });
    inserted++;
  }
  console.log(`transactions: ${inserted} Amazon line items inserted (${skipped} non-Amazon xlsx rows intentionally skipped — Teller/Plaid pull those duplicates)`);

  // Categorization rules: most-recent assignment wins per normalized description.
  // (Iterating in row order means later rows overwrite earlier ones.)
  const ruleMap = new Map<string, { categoryId: number | null; subcategoryId: number | null }>();
  for (const r of rows) {
    if ((!r.category || r.category === "#N/A") && (!r.subcategory || r.subcategory === "#N/A")) continue;
    const key = normalize(r.description);
    if (!key) continue;
    const categoryId = (r.category && r.category !== "#N/A")
      ? topLevelIds.get(r.category) ?? null
      : null;
    const subcategoryId = (r.subcategory && r.subcategory !== "#N/A" && r.category && r.category !== "#N/A")
      ? subIds.get(`${r.category}|${r.subcategory}`) ?? null
      : null;
    ruleMap.set(key, { categoryId, subcategoryId });
  }
  for (const [matchText, { categoryId, subcategoryId }] of ruleMap) {
    await db.insert(categorizationRules).values({
      matchText,
      matchType: "exact",
      categoryId,
      subcategoryId,
    });
  }
  console.log(`categorization rules: ${ruleMap.size}`);

  // Backfill: walk every currently-uncategorized transaction in the DB
  // and try a layered match strategy:
  //
  //   1. EXACT — normalized description equals a rule.match_text.
  //      Rare hit on aggregator data; aggregator wording differs from
  //      xlsx wording.
  //
  //   2. FUZZY — significant tokens (5+ chars, non-stopword) from the
  //      rule's match_text overlap with tokens in the transaction. Picks
  //      the rule with the highest overlap. Catches things like
  //      "Spotify USA" (Excel) ↔ "Spotify P099XXX" (Teller) where the
  //      merchant token is shared.
  //
  //   3. HEURISTIC — static transfer-pattern regexes (Internet transfer,
  //      Amex EPAYMENT, Wise, etc.). Catches inter-account moves and
  //      credit-card payments regardless of rule presence.
  //
  // Anything still uncategorized after this gets labeled via the UI; the
  // user's edits grow the rule table for next time.
  const { resolveCategoryWithHeuristics } = await import(
    "../../../apps/server/src/lib/categorize.js"
  );
  console.log("\nbackfilling rules + fuzzy match + heuristics onto existing uncategorized transactions…");
  const uncat = await db
    .select({ id: transactions.id, description: transactions.description })
    .from(transactions)
    .where(isNull(transactions.categoryId));

  // Build a fuzzy-match index from the rules — token → list of (rule, ruleTokens).
  // A "significant" rule token is 5+ alphanumeric chars and not a stopword.
  const STOPWORDS = new Set([
    "payment", "bill", "transfer", "deposit", "withdrawal", "purchase",
    "debit", "credit", "online", "mobile", "charge", "charges", "monthly",
    "subscription", "transaction", "merchant", "amazon", "amzn",  // amazon is too broad — match via line items instead
  ]);
  function significantTokens(text: string): string[] {
    return text.split(/[\s.\-_/&]+/).filter((t) => t.length >= 5 && !STOPWORDS.has(t));
  }
  const indexedRules: Array<{ tokens: string[]; categoryId: number; subcategoryId: number | null }> = [];
  for (const [matchText, { categoryId, subcategoryId }] of ruleMap) {
    if (categoryId === null) continue;
    const tokens = significantTokens(matchText);
    if (tokens.length === 0) continue;
    indexedRules.push({ tokens, categoryId, subcategoryId });
  }

  let backfilledByRule = 0;
  let backfilledByFuzzy = 0;
  let backfilledByHeuristic = 0;
  const nowIso = new Date().toISOString();
  for (const t of uncat) {
    const key = normalize(t.description);
    let categoryId: number | null = null;
    let subcategoryId: number | null = null;
    let mode: "rule" | "fuzzy" | "heuristic" | null = null;

    // 1. Exact.
    const exact = ruleMap.get(key);
    if (exact && exact.categoryId !== null) {
      categoryId = exact.categoryId;
      subcategoryId = exact.subcategoryId;
      mode = "rule";
    }
    // 2. Fuzzy.
    if (mode === null) {
      const tTokens = new Set(significantTokens(key));
      let bestScore = 0;
      let bestRule: typeof indexedRules[number] | null = null;
      for (const rule of indexedRules) {
        let score = 0;
        for (const tok of rule.tokens) if (tTokens.has(tok)) score++;
        // Require at least one overlap; prefer higher overlap.
        if (score > bestScore) {
          bestScore = score;
          bestRule = rule;
        }
      }
      if (bestRule && bestScore >= 1) {
        categoryId = bestRule.categoryId;
        subcategoryId = bestRule.subcategoryId;
        mode = "fuzzy";
      }
    }
    // 3. Heuristic.
    if (mode === null) {
      const h = await resolveCategoryWithHeuristics(db, t.description);
      if (h.categoryId !== null) {
        categoryId = h.categoryId;
        subcategoryId = h.subcategoryId;
        mode = "heuristic";
      }
    }

    if (mode === null) continue;
    await db.update(transactions).set({ categoryId, subcategoryId, updatedAt: nowIso })
      .where(eq(transactions.id, t.id));
    if (mode === "rule") backfilledByRule++;
    else if (mode === "fuzzy") backfilledByFuzzy++;
    else backfilledByHeuristic++;
  }
  console.log(`  by exact rule:  ${backfilledByRule}`);
  console.log(`  by fuzzy match: ${backfilledByFuzzy}`);
  console.log(`  by heuristics:  ${backfilledByHeuristic}`);
  console.log(`  still uncategorized: ${uncat.length - backfilledByRule - backfilledByFuzzy - backfilledByHeuristic}`);

  console.log("\nseed complete");
}

await main();
