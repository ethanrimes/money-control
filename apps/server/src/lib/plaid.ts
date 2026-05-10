// Plaid API client. Switches between sandbox and production at startup based
// on PLAID_ENV. client_id is shared; secret is per-environment.

import { Configuration, PlaidApi, PlaidEnvironments, type Products } from "plaid";
import { config } from "../config.js";

let _client: PlaidApi | null = null;

export function plaidConfigured(): boolean {
  return Boolean(config.plaid.clientId && config.plaid.secret);
}

export function getPlaid(): PlaidApi {
  if (_client) return _client;
  if (!plaidConfigured()) {
    throw new Error("Plaid is not configured — set PLAID_CLIENT_ID and PLAID_*_SECRET in .env");
  }
  const basePath = config.plaid.env === "production"
    ? PlaidEnvironments.production
    : PlaidEnvironments.sandbox;
  _client = new PlaidApi(
    new Configuration({
      basePath,
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": config.plaid.clientId,
          "PLAID-SECRET": config.plaid.secret,
        },
      },
    }),
  );
  return _client;
}

// Products we ask Plaid Link to enable. Keep this list MINIMAL — Plaid
// errors out with "Internal error" if you require a product the chosen
// institution doesn't support. Specifically `auth` (ACH routing numbers)
// must NOT be required: Amex credit cards don't expose routing numbers
// and Amex deposit OAuth handles auth differently — including it breaks
// the Amex flow.
//
// For balances + transactions + later investments, `transactions` alone is
// sufficient. The /accounts/balance/get endpoint we call in /plaid/sync
// works against any account regardless of the products you linked with.
export const LINK_PRODUCTS: Products[] = ["transactions" as Products];
