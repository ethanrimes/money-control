// Teller routes:
//   GET    /teller/config         — bootstrap data for the Teller Connect SDK
//   GET    /teller/enrollments    — list connected institutions (no tokens leaked)
//   POST   /teller/enrollments    — receive a Connect callback and persist tokens
//   DELETE /teller/enrollments/:id — disconnect an institution
//   POST   /teller/sync           — manual refresh: pull accounts + balances + txns
//
// Tokens are persisted server-side in the SQLite teller_enrollments table, so
// once the user links an institution it stays linked across server restarts
// and across web/mobile clients.

import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb } from "@moneycontrol/db";
import {
  accounts,
  balances,
  tellerEnrollments,
  transactions,
  type NewAccount,
  type NewBalance,
  type NewTransaction,
} from "@moneycontrol/db/schema";
import { config } from "../config.js";
import { resolveCategory } from "../lib/categorize.js";
import {
  TellerError,
  getBalance,
  listAccounts,
  listTransactions,
  tellerConfigured,
} from "../lib/teller.js";

export const tellerRoutes = new Hono();

tellerRoutes.get("/config", (c) => {
  return c.json({
    appId: config.teller.appId || null,
    environment: config.teller.env,
    mtlsConfigured: tellerConfigured(),
  });
});

// List connected enrollments, each with its nested accounts + latest balance.
// Never returns access_token. The dashboard's "Linked institutions" card is
// the only direct consumer; we also expose the unlinked accounts (e.g. seeded
// from the xlsx with no Teller backing yet) via /aggregator/summary.
tellerRoutes.get("/enrollments", async (c) => {
  const db = getDb();
  const ens = await db.select().from(tellerEnrollments);
  if (ens.length === 0) return c.json([]);

  // One round-trip for all accounts; group in JS.
  const allAccts = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      institution: accounts.institution,
      lastFour: accounts.lastFour,
      tellerEnrollmentId: accounts.tellerEnrollmentId,
      latestBalance: sql<number | null>`(
        SELECT current FROM ${balances}
        WHERE ${balances.accountId} = ${accounts.id}
        ORDER BY ${balances.asOfDate} DESC LIMIT 1
      )`,
    })
    .from(accounts);

  return c.json(
    ens.map((r) => ({
      id: r.id,
      enrollmentId: r.enrollmentId,
      institutionName: r.institutionName,
      userId: r.userId,
      createdAt: r.createdAt,
      accounts: allAccts
        .filter((a) => a.tellerEnrollmentId === r.id)
        .map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          institution: a.institution,
          lastFour: a.lastFour,
          latestBalance: a.latestBalance ?? 0,
        })),
    })),
  );
});

// Called by the web app after Teller Connect succeeds. Body shape mirrors the
// Connect callback payload:
//   { enrollment: { id, institution: { name } }, accessToken, user: { id } }
tellerRoutes.post("/enrollments", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    enrollment?: { id?: string; institution?: { name?: string } };
    accessToken?: string;
    user?: { id?: string };
  };
  const enrollmentId = body.enrollment?.id;
  const accessToken = body.accessToken;
  const institutionName = body.enrollment?.institution?.name ?? "Unknown";
  if (!enrollmentId || !accessToken) {
    return c.json({ error: "enrollment.id and accessToken are required" }, 400);
  }
  const db = getDb();
  const existing = await db
    .select()
    .from(tellerEnrollments)
    .where(eq(tellerEnrollments.enrollmentId, enrollmentId));
  if (existing.length > 0) {
    // Re-link: update token in case user re-completed Connect.
    await db
      .update(tellerEnrollments)
      .set({ accessToken, institutionName, userId: body.user?.id ?? null })
      .where(eq(tellerEnrollments.id, existing[0]!.id));
    return c.json({ id: existing[0]!.id, status: "updated" });
  }
  const inserted = await db
    .insert(tellerEnrollments)
    .values({
      enrollmentId,
      institutionName,
      accessToken,
      userId: body.user?.id ?? null,
    })
    .returning();
  return c.json({ id: inserted[0]!.id, status: "created" });
});

tellerRoutes.delete("/enrollments/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
  const db = getDb();
  await db.delete(tellerEnrollments).where(eq(tellerEnrollments.id, id));
  return c.json({ ok: true });
});

// Manual refresh. Iterates every enrollment, pulls accounts/balances/txns,
// dedupes transactions by teller_txn_id, auto-categorizes new ones via rules.
// Returns per-enrollment counts so the UI can show a "synced N transactions"
// toast.
tellerRoutes.post("/sync", async (c) => {
  if (!tellerConfigured()) {
    return c.json({
      error: "Teller mTLS material not found",
      hint: "Place certificate.pem + private_key.pem in ./teller/",
    }, 412);
  }

  const db = getDb();
  const enrollments = await db.select().from(tellerEnrollments);
  if (enrollments.length === 0) {
    return c.json({ enrollments: [], totals: { accounts: 0, balances: 0, transactions: 0 } });
  }

  let totalAccounts = 0;
  let totalBalances = 0;
  let totalTxns = 0;
  const perEnrollment: Array<{
    id: number;
    institutionName: string;
    accounts: number;
    balances: number;
    newTransactions: number;
    error?: string;
  }> = [];

  for (const en of enrollments) {
    const summary = { id: en.id, institutionName: en.institutionName, accounts: 0, balances: 0, newTransactions: 0 };
    try {
      // 1. Accounts: upsert by teller_account_id; backfill enrollment FK on
      //    existing rows so older syncs link up.
      const tellerAccts = await listAccounts(en.accessToken);
      const accountIdByTellerId = new Map<string, number>();
      for (const a of tellerAccts) {
        const existing = await db
          .select()
          .from(accounts)
          .where(eq(accounts.tellerAccountId, a.id));
        if (existing.length > 0) {
          accountIdByTellerId.set(a.id, existing[0]!.id);
          await db
            .update(accounts)
            .set({
              tellerEnrollmentId: en.id,
              institution: a.institution?.name ?? existing[0]!.institution,
              lastFour: a.last_four ?? existing[0]!.lastFour,
            })
            .where(eq(accounts.id, existing[0]!.id));
        } else {
          const newAcct: NewAccount = {
            tellerAccountId: a.id,
            tellerEnrollmentId: en.id,
            name: a.name,
            type: a.type,
            institution: a.institution?.name ?? null,
            lastFour: a.last_four ?? null,
          };
          const inserted = await db.insert(accounts).values(newAcct).returning({ id: accounts.id });
          accountIdByTellerId.set(a.id, inserted[0]!.id);
        }
        summary.accounts++;
      }

      // 2. Balance per account.
      const todayIso = new Date().toISOString().slice(0, 10);
      for (const a of tellerAccts) {
        const accountId = accountIdByTellerId.get(a.id)!;
        try {
          const bal = await getBalance(en.accessToken, a.id);
          const current = Number(bal.ledger ?? "0");
          const available = bal.available != null ? Number(bal.available) : null;
          const balRow: NewBalance = {
            accountId,
            asOfDate: todayIso,
            current,
            available,
          };
          // Upsert by (accountId, asOfDate): replace if same day already pulled.
          await db
            .insert(balances)
            .values(balRow)
            .onConflictDoUpdate({
              target: [balances.accountId, balances.asOfDate],
              set: { current, available },
            });
          summary.balances++;
        } catch (err) {
          console.warn(`balance fetch failed for ${a.id}: ${(err as Error).message}`);
        }
      }

      // 3. Transactions: pull recent, dedupe by teller_txn_id, categorize new ones.
      for (const a of tellerAccts) {
        const accountId = accountIdByTellerId.get(a.id)!;
        try {
          const txns = await listTransactions(en.accessToken, a.id, { count: 200 });
          for (const t of txns) {
            const existing = await db
              .select({ id: transactions.id })
              .from(transactions)
              .where(eq(transactions.tellerTxnId, t.id))
              .limit(1);
            if (existing.length > 0) continue;
            const { categoryId, subcategoryId } = await resolveCategory(db, t.description);
            const row: NewTransaction = {
              tellerTxnId: t.id,
              accountId,
              date: t.date,
              description: t.description,
              rawDescription: t.description,
              amount: Number(t.amount),
              categoryId,
              subcategoryId,
              source: "teller",
            };
            await db.insert(transactions).values(row);
            summary.newTransactions++;
          }
        } catch (err) {
          console.warn(`txns fetch failed for ${a.id}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      const e = err as Error;
      perEnrollment.push({ ...summary, error: e instanceof TellerError ? `${e.status}: ${e.message}` : e.message });
      continue;
    }
    perEnrollment.push(summary);
    totalAccounts += summary.accounts;
    totalBalances += summary.balances;
    totalTxns += summary.newTransactions;
  }

  return c.json({
    enrollments: perEnrollment,
    totals: { accounts: totalAccounts, balances: totalBalances, transactions: totalTxns },
    syncedAt: new Date().toISOString(),
  });
});
