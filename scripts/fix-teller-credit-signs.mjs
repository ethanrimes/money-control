// One-shot data migration: flip the sign of every source='teller' transaction
// on a credit-type account so they match the cash-flow convention used
// everywhere else (purchase = negative, payment = positive).
//
// Teller returns credit-card amounts as balance-deltas (purchase = +50 because
// you owe $50 more). Our schema and every budget calc assumes cash-flow form.
// The teller sync route now flips on the way in for new rows; this script
// fixes the rows that came in before the fix was deployed.
//
// Safe to re-run — the flip is from current sign to current sign of opposite
// rows, so calling it twice would un-do it. Don't call it twice without
// thinking. The script prints how many rows changed so you can sanity-check
// before doing anything else.

import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dbPath = path.join(root, "data", "moneycontrol.db");
const db = new DatabaseSync(dbPath);

const rows = db.prepare(`
  SELECT t.id, t.amount, t.description
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  WHERE t.source = 'teller' AND a.type = 'credit'
`).all();

console.log(`Found ${rows.length} Teller-synced credit-card transactions.`);
const update = db.prepare(`UPDATE transactions SET amount = -amount, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
db.exec("BEGIN");
try {
  for (const r of rows) update.run(r.id);
  db.exec("COMMIT");
  console.log(`Flipped signs on ${rows.length} rows.`);
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}
