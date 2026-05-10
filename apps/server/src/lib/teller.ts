// Teller API client — mTLS-authenticated, basic-auth with the per-enrollment
// access_token. Requires `teller/certificate.pem` and `teller/private_key.pem`
// next to the repo root (see config.ts). Both are gitignored.

import fs from "node:fs";
import { Agent, fetch as undiciFetch } from "undici";
import { config } from "../config.js";

let _dispatcher: Agent | null = null;

export class TellerError extends Error {
  constructor(public status: number, public body: string, message: string) {
    super(message);
  }
}

function getDispatcher(): Agent {
  if (_dispatcher) return _dispatcher;
  const cert = fs.readFileSync(config.teller.certPath, "utf8");
  const key = fs.readFileSync(config.teller.keyPath, "utf8");
  _dispatcher = new Agent({ connect: { cert, key } });
  return _dispatcher;
}

export function tellerConfigured(): boolean {
  try {
    fs.accessSync(config.teller.certPath, fs.constants.R_OK);
    fs.accessSync(config.teller.keyPath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function tellerFetch<T>(accessToken: string, path: string): Promise<T> {
  if (!tellerConfigured()) {
    throw new TellerError(0, "", "Teller mTLS material not found at teller/certificate.pem + teller/private_key.pem");
  }
  const url = `${config.teller.apiBase}${path}`;
  // Teller uses HTTP Basic with access_token as username, empty password.
  const auth = "Basic " + Buffer.from(`${accessToken}:`).toString("base64");
  const res = await undiciFetch(url, {
    method: "GET",
    headers: { Authorization: auth, Accept: "application/json" },
    dispatcher: getDispatcher(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new TellerError(res.status, text, `Teller ${path} ${res.status}`);
  }
  return JSON.parse(text) as T;
}

// Domain shapes — only the fields we actually consume.
export interface TellerAccount {
  id: string;
  name: string;
  type: "depository" | "credit";
  subtype?: string;
  institution?: { id: string; name: string };
  last_four?: string;
}

export interface TellerBalance {
  account_id: string;
  ledger?: string;   // e.g. "1234.56" — string per Teller spec
  available?: string;
}

export interface TellerTransaction {
  id: string;
  account_id: string;
  date: string; // YYYY-MM-DD
  description: string;
  amount: string; // signed string
  details?: { category?: string };
  status?: "posted" | "pending";
}

export async function listAccounts(accessToken: string): Promise<TellerAccount[]> {
  return tellerFetch<TellerAccount[]>(accessToken, "/accounts");
}

export async function getBalance(accessToken: string, accountId: string): Promise<TellerBalance> {
  return tellerFetch<TellerBalance>(accessToken, `/accounts/${accountId}/balances`);
}

// Teller paginates with `from_id` + `count`; default returns most-recent.
export async function listTransactions(
  accessToken: string,
  accountId: string,
  opts: { count?: number; fromId?: string } = {},
): Promise<TellerTransaction[]> {
  const params = new URLSearchParams();
  if (opts.count) params.set("count", String(opts.count));
  if (opts.fromId) params.set("from_id", opts.fromId);
  const qs = params.toString();
  const path = `/accounts/${accountId}/transactions${qs ? `?${qs}` : ""}`;
  return tellerFetch<TellerTransaction[]>(accessToken, path);
}
