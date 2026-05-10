// One-shot:
//   1. Creates the two Amex deposit accounts (HYSA + Rewards Checking) via
//      POST /accounts.
//   2. Reads csv/transactions.CSV, appends the user-flagged pending May 11
//      deposit row.
//   3. Renames the original file to include a timestamp.
//   4. POSTs the CSV body to /import/csv with tag "csv-import:<timestamp>"
//      so all imported rows can be deleted later when Plaid links the real
//      Amex account.
//
// Re-run-safe: server endpoints are idempotent on name (account create) and
// on (account, date, description, amount) (transaction insert).

import fs from "node:fs";
import path from "node:path";

const SERVER = process.env.SERVER ?? "http://localhost:3001";
const root = path.resolve(import.meta.dirname, "..");
const csvDir = path.join(root, "csv");
const sourcePath = path.join(csvDir, "transactions.CSV");

async function post(p, body) {
  const res = await fetch(`${SERVER}${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${p} ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

console.log("Creating HYSA account…");
const hysa = await post("/accounts", {
  name: "Amex High Yield Savings",
  type: "depository",
  subtype: "savings",
  institution: "American Express",
  lastFour: "5729",
});
console.log("  id:", hysa.id, "name:", hysa.name);

console.log("Creating Amex Rewards Checking account…");
const checking = await post("/accounts", {
  name: "Amex Rewards Checking",
  type: "depository",
  subtype: "checking",
  institution: "American Express",
  lastFour: "3842",
});
console.log("  id:", checking.id, "name:", checking.name);

if (!fs.existsSync(sourcePath)) {
  console.error(`source CSV missing: ${sourcePath} — already archived?`);
  process.exit(1);
}
const original = fs.readFileSync(sourcePath, "utf8");
const pendingRow = `2026-05-11,"One-Time Deposit BANK OF AMERICA NA CHK (-5616)",1800.00\n`;
const csvBody = original.endsWith("\n") ? original + pendingRow : original + "\n" + pendingRow;

// Rename the source so future imports don't trample it.
const stamp = new Date().toISOString().replace(/:/g, "-").replace(/\..+$/, "");
const archived = path.join(csvDir, `transactions_${stamp}.csv`);
fs.renameSync(sourcePath, archived);
console.log(`Archived source to: ${path.relative(root, archived)}`);

const tag = `csv-import:${stamp}`;
console.log(`Importing into HYSA (id ${hysa.id}) with tag "${tag}"…`);
const res = await post("/import/csv", {
  accountId: hysa.id,
  csv: csvBody,
  tag,
});
console.log(`  inserted: ${res.inserted}`);
console.log(`  skipped (dupes): ${res.skipped}`);
if (res.errors && res.errors.length > 0) {
  console.log(`  errors:`, res.errors);
}

console.log(`\nDone. To undo this batch later:`);
console.log(`  curl -X DELETE "${SERVER}/import/csv?tag=${encodeURIComponent(tag)}"`);
