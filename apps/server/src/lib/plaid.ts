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

// Products we ask for during Link. Investments lets us pull Fidelity holdings;
// auth + transactions cover the Amex deposit case (auth gates depository link).
export const LINK_PRODUCTS: Products[] = ["transactions" as Products, "auth" as Products];
