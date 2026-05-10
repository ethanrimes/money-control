import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { config } from "./config.js";
import { accountsRoutes } from "./routes/accounts.js";
import { aggregatorRoutes } from "./routes/aggregator.js";
import { budgetRoutes } from "./routes/budget.js";
import { categoriesRoutes } from "./routes/categories.js";
import { plaidRoutes } from "./routes/plaid.js";
import { summaryRoutes } from "./routes/summary.js";
import { tellerRoutes } from "./routes/teller.js";
import { transactionsRoutes } from "./routes/transactions.js";

const app = new Hono();
app.use("*", logger());
app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"] }));

app.get("/health", (c) => c.json({ ok: true, version: "0.1.0" }));

app.route("/accounts", accountsRoutes);
app.route("/transactions", transactionsRoutes);
app.route("/categories", categoriesRoutes);
app.route("/budget", budgetRoutes);
app.route("/summary", summaryRoutes);
app.route("/teller", tellerRoutes);
app.route("/plaid", plaidRoutes);
app.route("/aggregator", aggregatorRoutes);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`@moneycontrol/server listening on http://localhost:${info.port}`);
});
