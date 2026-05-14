import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { withUser } from "@moneycontrol/db";
import { accountsRoutes } from "./routes/accounts.js";
import { aggregatorRoutes } from "./routes/aggregator.js";
import { amazonRoutes } from "./routes/amazon.js";
import { budgetRoutes } from "./routes/budget.js";
import { categoriesRoutes } from "./routes/categories.js";
import { importRoutes } from "./routes/import.js";
import { plaidRoutes } from "./routes/plaid.js";
import { summaryRoutes } from "./routes/summary.js";
import { tellerRoutes } from "./routes/teller.js";
import { transactionsRoutes } from "./routes/transactions.js";

// The Hono app, exported for both the standalone local-dev server (index.ts)
// and the Next.js catch-all API route on Vercel (apps/web/app/api/[[...path]]).
//
// Auth model: the *caller* (Next.js wrapper in production, or the dev server's
// dev-bypass below) is responsible for validating the user and injecting the
// x-user-id header. This middleware wraps each request in withUser() so RLS
// auto-filters every query by that user id.
export const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin) => origin ?? "*",
    credentials: true,
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "x-user-id"],
  }),
);

app.get("/health", (c) => c.json({ ok: true, version: "0.1.0" }));

// Per-request tenancy: read the trusted x-user-id header (set by the Next.js
// wrapper after verifying the Supabase session cookie) and run the rest of
// the request inside withUser(). RLS policies + the user_id column DEFAULT
// then scope every query/insert to that user.
app.use("*", async (c, next) => {
  if (c.req.path === "/health") return next();
  const userId =
    c.req.header("x-user-id") ?? c.req.header("X-User-Id") ?? null;
  if (!userId) {
    // No identity: in production this means the Next wrapper rejected the
    // request before getting here, so we should never see it. Surface a 401
    // so misconfigurations are loud.
    return c.json({ error: "unauthenticated" }, 401);
  }
  return withUser(userId, () => next());
});

app.route("/accounts", accountsRoutes);
app.route("/transactions", transactionsRoutes);
app.route("/categories", categoriesRoutes);
app.route("/budget", budgetRoutes);
app.route("/summary", summaryRoutes);
app.route("/teller", tellerRoutes);
app.route("/plaid", plaidRoutes);
app.route("/aggregator", aggregatorRoutes);
app.route("/import", importRoutes);
app.route("/import", amazonRoutes);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});
