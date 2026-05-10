// Aggregator-agnostic refresh endpoint. The dashboard's "Refresh" button hits
// this and we fan out to each aggregator's sync internally. Keeps the UI
// from having to know there are two providers.

import { Hono } from "hono";
import { tellerConfigured } from "../lib/teller.js";
import { plaidConfigured } from "../lib/plaid.js";

export const aggregatorRoutes = new Hono();

// POST /aggregator/sync — calls both Teller and Plaid syncs (if configured)
// and merges their results.
aggregatorRoutes.post("/sync", async (c) => {
  // Hit each provider's sync route directly via the running Hono app. Using
  // c.req.url ensures we go through the actual route handlers (and their
  // env / DB setup) rather than duplicating logic.
  const base = new URL(c.req.url).origin;
  const calls: Array<Promise<unknown>> = [];
  if (tellerConfigured()) {
    calls.push(fetch(`${base}/teller/sync`, { method: "POST" }).then((r) => r.json()).catch((e) => ({ error: String(e), aggregator: "teller" })));
  }
  if (plaidConfigured()) {
    calls.push(fetch(`${base}/plaid/sync`, { method: "POST" }).then((r) => r.json()).catch((e) => ({ error: String(e), aggregator: "plaid" })));
  }
  const [teller, plaid] = await Promise.all([
    tellerConfigured() ? calls.shift() : Promise.resolve(null),
    plaidConfigured() ? calls.shift() : Promise.resolve(null),
  ]);

  const totals = { accounts: 0, balances: 0, transactions: 0 };
  type Result = { totals?: typeof totals } & Record<string, unknown>;
  for (const r of [teller, plaid]) {
    const t = (r as Result | null)?.totals;
    if (t) {
      totals.accounts += t.accounts ?? 0;
      totals.balances += t.balances ?? 0;
      totals.transactions += t.transactions ?? 0;
    }
  }

  return c.json({
    teller,
    plaid,
    totals,
    syncedAt: new Date().toISOString(),
  });
});
