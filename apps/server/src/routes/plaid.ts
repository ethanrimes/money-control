// Plaid routes. Mirrors the Teller layout but uses Plaid's Link-token flow:
//
//   1. Client asks /plaid/link-token → server creates a link_token via Plaid
//   2. Client opens Plaid Link with link_token → gets a public_token
//   3. Client POSTs public_token to /plaid/items → server exchanges for
//      access_token (long-lived) and persists in plaid_items
//   4. /plaid/sync uses /transactions/sync cursor-based pagination so
//      subsequent refreshes only pull deltas

import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { CountryCode, Products } from "plaid";
import { getDb } from "@moneycontrol/db";
import {
  accounts,
  balances,
  plaidItems,
  transactions,
  type NewAccount,
  type NewBalance,
  type NewPlaidItem,
  type NewTransaction,
} from "@moneycontrol/db/schema";
import { normalizePlaidAccountType, normalizePlaidAmount } from "@moneycontrol/core";
import { config } from "../config.js";
import { resolveCategoryWithHeuristics } from "../lib/categorize.js";
import { LINK_PRODUCTS, getPlaid, plaidConfigured } from "../lib/plaid.js";

export const plaidRoutes = new Hono();

plaidRoutes.get("/config", (c) => {
  return c.json({
    env: config.plaid.env,
    configured: plaidConfigured(),
  });
});

// Step 1: server-side link_token creation. Plaid Link needs this token to
// initialize. Tokens are short-lived (30 min) and single-use.
plaidRoutes.post("/link-token", async (c) => {
  if (!plaidConfigured()) {
    return c.json({ error: "Plaid not configured", hint: "Set PLAID_CLIENT_ID and PLAID_*_SECRET" }, 412);
  }
  try {
    const plaid = getPlaid();
    const res = await plaid.linkTokenCreate({
      user: { client_user_id: "local-user" },
      client_name: "MoneyControl",
      products: LINK_PRODUCTS,
      country_codes: [CountryCode.Us],
      language: "en",
    });
    return c.json({ linkToken: res.data.link_token, expiration: res.data.expiration });
  } catch (err) {
    return c.json({ error: extractPlaidError(err) }, 500);
  }
});

// Step 3: receive Plaid Link's onSuccess payload.
//   Body: { publicToken: string, metadata: { institution: { name, institution_id }, accounts: [...] } }
plaidRoutes.post("/items", async (c) => {
  const body = await c.req.json().catch(() => ({})) as {
    publicToken?: string;
    metadata?: {
      institution?: { name?: string; institution_id?: string };
    };
  };
  if (!body.publicToken) return c.json({ error: "publicToken is required" }, 400);

  try {
    const plaid = getPlaid();
    const exchange = await plaid.itemPublicTokenExchange({ public_token: body.publicToken });
    const accessToken = exchange.data.access_token;
    const itemId = exchange.data.item_id;
    const institutionName = body.metadata?.institution?.name ?? "Unknown";
    const institutionId = body.metadata?.institution?.institution_id ?? null;

    const db = getDb();
    const existing = await db.select().from(plaidItems).where(eq(plaidItems.itemId, itemId));
    if (existing.length > 0) {
      // Re-link: refresh the access token.
      await db
        .update(plaidItems)
        .set({ accessToken, institutionName, institutionId })
        .where(eq(plaidItems.id, existing[0]!.id));
      return c.json({ id: existing[0]!.id, status: "updated" });
    }
    const row: NewPlaidItem = {
      itemId,
      institutionName,
      institutionId,
      accessToken,
      cursor: null,
    };
    const inserted = await db.insert(plaidItems).values(row).returning({ id: plaidItems.id });
    return c.json({ id: inserted[0]!.id, status: "created" });
  } catch (err) {
    return c.json({ error: extractPlaidError(err) }, 500);
  }
});

// Lists Plaid items with their child accounts nested. Mirrors
// /teller/enrollments so /summary/accounts can merge both aggregators.
plaidRoutes.get("/items", async (c) => {
  const db = getDb();
  const items = await db.select().from(plaidItems);
  if (items.length === 0) return c.json([]);
  const allAccts = await db.select().from(accounts);
  return c.json(
    items.map((it) => ({
      id: it.id,
      itemId: it.itemId,
      institutionName: it.institutionName,
      institutionId: it.institutionId,
      createdAt: it.createdAt,
      accounts: allAccts.filter((a) => a.plaidItemId === it.id),
    })),
  );
});

plaidRoutes.delete("/items/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
  const db = getDb();
  const row = (await db.select().from(plaidItems).where(eq(plaidItems.id, id)))[0];
  if (!row) return c.json({ error: "not found" }, 404);

  // Best-effort tell Plaid to forget the Item, then drop our row. If Plaid's
  // call fails we still want to clean up locally so the UI isn't stuck.
  try {
    await getPlaid().itemRemove({ access_token: row.accessToken });
  } catch (err) {
    console.warn(`itemRemove failed for item ${row.itemId}: ${extractPlaidError(err)}`);
  }
  await db.delete(plaidItems).where(eq(plaidItems.id, id));
  return c.json({ ok: true });
});

// Manual sync. For each Plaid item:
//   - upsert accounts (Plaid returns the full list each call)
//   - persist today's balance per account
//   - incremental /transactions/sync using stored cursor; auto-categorize
//     new transactions via the rule table
plaidRoutes.post("/sync", async (c) => {
  if (!plaidConfigured()) {
    return c.json({ error: "Plaid not configured" }, 412);
  }
  const db = getDb();
  const items = await db.select().from(plaidItems);
  if (items.length === 0) {
    return c.json({ items: [], totals: { accounts: 0, balances: 0, transactions: 0 } });
  }

  const plaid = getPlaid();
  let totalAccts = 0;
  let totalBals = 0;
  let totalTxns = 0;
  const perItem: Array<{
    id: number;
    institutionName: string;
    accounts: number;
    balances: number;
    newTransactions: number;
    error?: string;
  }> = [];

  for (const it of items) {
    const summary = { id: it.id, institutionName: it.institutionName, accounts: 0, balances: 0, newTransactions: 0 };
    try {
      // 1. Accounts (with balances baked in — Plaid returns them together).
      const acctRes = await plaid.accountsBalanceGet({ access_token: it.accessToken });
      const todayIso = new Date().toISOString().slice(0, 10);
      const accountIdByPlaidId = new Map<string, number>();

      for (const a of acctRes.data.accounts) {
        const ourType = normalizePlaidAccountType(a.type as string);
        const existing = await db.select().from(accounts).where(eq(accounts.plaidAccountId, a.account_id));
        let accountId: number;
        if (existing.length > 0) {
          accountId = existing[0]!.id;
          await db.update(accounts).set({
            plaidItemId: it.id,
            name: a.name ?? existing[0]!.name,
            subtype: a.subtype ?? existing[0]!.subtype,
            institution: it.institutionName,
            lastFour: a.mask ?? existing[0]!.lastFour,
            type: ourType,
          }).where(eq(accounts.id, accountId));
        } else {
          const newAcct: NewAccount = {
            plaidAccountId: a.account_id,
            plaidItemId: it.id,
            name: a.name ?? a.official_name ?? "Account",
            type: ourType,
            subtype: a.subtype ?? null,
            institution: it.institutionName,
            lastFour: a.mask ?? null,
          };
          const ins = await db.insert(accounts).values(newAcct).returning({ id: accounts.id });
          accountId = ins[0]!.id;
        }
        accountIdByPlaidId.set(a.account_id, accountId);
        summary.accounts++;

        // Current balance: prefer 'current'; available is sometimes null on credit.
        // For credit accounts, Plaid returns positive = amount owed, same as us.
        const current = Number(a.balances.current ?? 0);
        const available = a.balances.available != null ? Number(a.balances.available) : null;
        const balRow: NewBalance = { accountId, asOfDate: todayIso, current, available };
        await db.insert(balances).values(balRow).onConflictDoUpdate({
          target: [balances.accountId, balances.asOfDate],
          set: { current, available },
        });
        summary.balances++;
      }

      // 2. Transactions: incremental cursor pagination. Plaid returns
      // {added, modified, removed, next_cursor, has_more}.
      let cursor = it.cursor ?? undefined;
      let hasMore = true;
      while (hasMore) {
        const txRes = await plaid.transactionsSync({
          access_token: it.accessToken,
          cursor,
          count: 500,
        });
        const data = txRes.data;

        for (const t of data.added) {
          const accountId = accountIdByPlaidId.get(t.account_id);
          if (!accountId) continue; // unknown account (rare)
          const existing = await db.select({ id: transactions.id })
            .from(transactions)
            .where(eq(transactions.plaidTransactionId, t.transaction_id))
            .limit(1);
          if (existing.length > 0) continue;
          const amount = normalizePlaidAmount(Number(t.amount));
          const description = t.name ?? t.merchant_name ?? "Transaction";
          const { categoryId, subcategoryId } = await resolveCategoryWithHeuristics(db, description);
          const row: NewTransaction = {
            plaidTransactionId: t.transaction_id,
            accountId,
            date: t.date,
            description,
            rawDescription: description,
            amount,
            categoryId,
            subcategoryId,
            source: "plaid",
          };
          await db.insert(transactions).values(row);
          summary.newTransactions++;
        }

        for (const t of data.modified) {
          const accountId = accountIdByPlaidId.get(t.account_id);
          if (!accountId) continue;
          const amount = normalizePlaidAmount(Number(t.amount));
          const description = t.name ?? t.merchant_name ?? "Transaction";
          await db
            .update(transactions)
            .set({ date: t.date, description, amount, updatedAt: new Date() })
            .where(eq(transactions.plaidTransactionId, t.transaction_id));
        }

        for (const r of data.removed) {
          if (r.transaction_id) {
            await db.delete(transactions).where(eq(transactions.plaidTransactionId, r.transaction_id));
          }
        }

        cursor = data.next_cursor;
        hasMore = data.has_more;
      }
      // Persist the last cursor so the next /sync only sees deltas.
      if (cursor) {
        await db.update(plaidItems).set({ cursor }).where(eq(plaidItems.id, it.id));
      }
    } catch (err) {
      perItem.push({ ...summary, error: extractPlaidError(err) });
      continue;
    }
    perItem.push(summary);
    totalAccts += summary.accounts;
    totalBals += summary.balances;
    totalTxns += summary.newTransactions;
  }

  return c.json({
    items: perItem,
    totals: { accounts: totalAccts, balances: totalBals, transactions: totalTxns },
    syncedAt: new Date().toISOString(),
  });
});

// Plaid SDK errors come as AxiosError with the structured error body nested.
// Pull out the most useful message for surfacing to the client.
function extractPlaidError(err: unknown): string {
  const e = err as { response?: { data?: { error_message?: string; error_code?: string } }; message?: string };
  const data = e.response?.data;
  if (data?.error_message) return `${data.error_code ?? "PLAID_ERROR"}: ${data.error_message}`;
  return e.message ?? String(err);
}
