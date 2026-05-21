// One-shot migration: SQLite (data/moneycontrol.db) -> Supabase Postgres.
//
// 1. Ensure a Supabase auth user exists for the configured email.
// 2. ID-remap every legacy SERIAL PK as we insert into Postgres so FKs
//    (parent_id, account_id, category_id, subcategory_id) survive.
// 3. Insert with the service role so RLS doesn't fight us; we stamp user_id
//    explicitly on every row.
//
// Idempotency: bails if any tenant table already has rows for this user.

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
// Tiny inline .env loader so we don't depend on dotenv (which is pruned by npm
// install --no-save and we don't want to add it to package.json).
for (const line of fs.readFileSync(path.join(repoRoot, 'csv', '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

const EMAIL = process.env.MIGRATE_EMAIL || 'ekallett@gmail.com';
const PASSWORD = process.env.MIGRATE_PASSWORD;
if (!PASSWORD) {
  console.error('FATAL: MIGRATE_PASSWORD not set');
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SECRET_KEY;
const PG_URL       = process.env.DATABASE_URL;
if (!SUPABASE_URL || !SERVICE_KEY || !PG_URL) {
  console.error('FATAL: need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY + DATABASE_URL');
  process.exit(1);
}

// ---- 1. Get-or-create the Supabase auth user ----
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function ensureUser() {
  // listUsers is paginated; one page of 1000 is plenty for a personal project.
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) throw listErr;
  const existing = list.users.find((u) => (u.email || '').toLowerCase() === EMAIL.toLowerCase());
  if (existing) {
    console.log('Auth user already exists:', existing.id);
    // Update password so the user can definitely log in.
    const { error: upErr } = await admin.auth.admin.updateUserById(existing.id, {
      password: PASSWORD,
      email_confirm: true,
    });
    if (upErr) throw upErr;
    console.log('  password reset + email confirmed');
    return existing.id;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  console.log('Created auth user:', data.user.id);
  return data.user.id;
}

const userId = await ensureUser();

// ---- 2. Connect to Postgres + SQLite ----
const pgClient = new pg.Client({ connectionString: PG_URL, ssl: { rejectUnauthorized: false } });
await pgClient.connect();

const sqlite = new Database(path.join(repoRoot, 'data', 'moneycontrol.db'), { readonly: true });

// Abort if anything already migrated for this user (keeps the script safely
// re-runnable; deliberately not idempotent at row level).
for (const t of ['accounts', 'categories', 'transactions', 'categorization_rules',
                 'balances', 'budget_settings', 'teller_enrollments', 'plaid_items']) {
  const { rows } = await pgClient.query(
    `select count(*)::int as c from public.${t} where user_id = $1`,
    [userId],
  );
  if (rows[0].c > 0) {
    console.error(`FATAL: ${rows[0].c} rows already in public.${t} for user ${userId}. Aborting.`);
    await pgClient.end(); sqlite.close(); process.exit(1);
  }
}

// ---- 3. Migrate, building id-remap maps as we go ----
await pgClient.query('BEGIN');

const idMap = {
  accounts: new Map(),
  categories: new Map(),
  teller_enrollments: new Map(),
  plaid_items: new Map(),
};

async function insertOne(table, cols, row) {
  const params = cols.map((_, i) => `$${i + 1}`).join(', ');
  const sql = `insert into public.${table} (${cols.join(', ')}) values (${params}) returning id`;
  const vals = cols.map((c) => row[c]);
  const { rows } = await pgClient.query(sql, vals);
  return rows[0].id;
}

// --- teller_enrollments (FK target for accounts.teller_enrollment_id) ---
for (const r of sqlite.prepare('select * from teller_enrollments').all()) {
  const newId = await insertOne('teller_enrollments',
    ['user_id', 'enrollment_id', 'institution_name', 'access_token', 'teller_user_id', 'created_at'],
    { user_id: userId, enrollment_id: r.enrollment_id, institution_name: r.institution_name,
      access_token: r.access_token, teller_user_id: r.user_id, created_at: r.created_at });
  idMap.teller_enrollments.set(r.id, newId);
}
console.log(`teller_enrollments: ${idMap.teller_enrollments.size}`);

// --- plaid_items (FK target for accounts.plaid_item_id) ---
for (const r of sqlite.prepare('select * from plaid_items').all()) {
  const newId = await insertOne('plaid_items',
    ['user_id', 'item_id', 'institution_name', 'institution_id', 'access_token', 'cursor', 'created_at'],
    { user_id: userId, ...r });
  idMap.plaid_items.set(r.id, newId);
}
console.log(`plaid_items: ${idMap.plaid_items.size}`);

// --- accounts ---
for (const r of sqlite.prepare('select * from accounts').all()) {
  const newId = await insertOne('accounts',
    ['user_id', 'teller_account_id', 'teller_enrollment_id', 'plaid_account_id', 'plaid_item_id',
     'name', 'type', 'subtype', 'institution', 'last_four', 'created_at'],
    { user_id: userId,
      teller_account_id: r.teller_account_id,
      teller_enrollment_id: r.teller_enrollment_id != null ? idMap.teller_enrollments.get(r.teller_enrollment_id) : null,
      plaid_account_id: r.plaid_account_id,
      plaid_item_id: r.plaid_item_id != null ? idMap.plaid_items.get(r.plaid_item_id) : null,
      name: r.name, type: r.type, subtype: r.subtype,
      institution: r.institution, last_four: r.last_four,
      created_at: r.created_at });
  idMap.accounts.set(r.id, newId);
}
console.log(`accounts: ${idMap.accounts.size}`);

// --- categories: self-referential, insert parents first via topo order ---
// SQLite tolerated duplicate (name, parent_id) but Postgres has a unique index
// on (user_id, name, coalesce(parent_id, 0)). Dedupe by reusing the existing
// id for any duplicate we hit during insert.
async function upsertCategory(row) {
  const { rows } = await pgClient.query(
    `insert into public.categories (user_id, name, parent_id, type, color, created_at)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (user_id, name, coalesce(parent_id, 0::bigint)) do update
       set name = excluded.name
     returning id`,
    [userId, row.name, row.parent_id, row.type, row.color, row.created_at],
  );
  return rows[0].id;
}

const allCats = sqlite.prepare('select * from categories').all();
const pending = [...allCats];
let safety = pending.length * 5;
while (pending.length && safety-- > 0) {
  const r = pending.shift();
  if (r.parent_id != null && !idMap.categories.has(r.parent_id)) {
    pending.push(r);
    continue;
  }
  const newId = await upsertCategory({
    name: r.name,
    parent_id: r.parent_id != null ? idMap.categories.get(r.parent_id) : null,
    type: r.type, color: r.color, created_at: r.created_at,
  });
  idMap.categories.set(r.id, newId);
}
if (pending.length) throw new Error('categories: cycle in parent_id?');
console.log(`categories: ${idMap.categories.size} (deduped from ${allCats.length})`);

// --- categorization_rules ---
let ruleN = 0;
for (const r of sqlite.prepare('select * from categorization_rules').all()) {
  await insertOne('categorization_rules',
    ['user_id', 'match_text', 'match_type', 'category_id', 'subcategory_id',
     'priority', 'hits', 'last_used_at', 'created_at'],
    { user_id: userId, match_text: r.match_text, match_type: r.match_type,
      category_id: r.category_id != null ? idMap.categories.get(r.category_id) : null,
      subcategory_id: r.subcategory_id != null ? idMap.categories.get(r.subcategory_id) : null,
      priority: r.priority, hits: r.hits,
      last_used_at: r.last_used_at, created_at: r.created_at });
  ruleN++;
}
console.log(`categorization_rules: ${ruleN}`);

// --- balances ---
let balN = 0;
for (const r of sqlite.prepare('select * from balances').all()) {
  await insertOne('balances',
    ['user_id', 'account_id', 'as_of_date', 'current', 'available', 'created_at'],
    { user_id: userId, account_id: idMap.accounts.get(r.account_id),
      as_of_date: r.as_of_date, current: r.current, available: r.available,
      created_at: r.created_at });
  balN++;
}
console.log(`balances: ${balN}`);

// --- budget_settings ---
let bsN = 0;
for (const r of sqlite.prepare('select * from budget_settings').all()) {
  await insertOne('budget_settings',
    ['user_id', 'monthly_savings_target', 'effective_from', 'created_at'],
    { user_id: userId, monthly_savings_target: r.monthly_savings_target,
      effective_from: r.effective_from, created_at: r.created_at });
  bsN++;
}
console.log(`budget_settings: ${bsN}`);

// --- transactions ---
let txnN = 0;
for (const r of sqlite.prepare('select * from transactions').all()) {
  await insertOne('transactions',
    ['user_id', 'teller_txn_id', 'plaid_transaction_id', 'account_id', 'date',
     'description', 'raw_description', 'amount', 'category_id', 'subcategory_id',
     'source', 'source_file', 'notes', 'created_at', 'updated_at'],
    { user_id: userId, teller_txn_id: r.teller_txn_id,
      plaid_transaction_id: r.plaid_transaction_id,
      account_id: idMap.accounts.get(r.account_id),
      date: r.date, description: r.description, raw_description: r.raw_description,
      amount: r.amount,
      category_id: r.category_id != null ? idMap.categories.get(r.category_id) : null,
      subcategory_id: r.subcategory_id != null ? idMap.categories.get(r.subcategory_id) : null,
      source: r.source, source_file: r.source_file, notes: r.notes,
      created_at: r.created_at, updated_at: r.updated_at });
  txnN++;
}
console.log(`transactions: ${txnN}`);

await pgClient.query('COMMIT');
console.log('\nMigration committed. user_id =', userId);

await pgClient.end();
sqlite.close();
