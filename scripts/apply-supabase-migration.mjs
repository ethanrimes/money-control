// One-shot: apply supabase/migrations/0001_init.sql to the linked project
// using the DIRECT_URL (port 5432, not the pooler). Idempotent guard: bail if
// public.accounts already exists.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(repoRoot, 'csv', '.env') });

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('FATAL: neither DIRECT_URL nor DATABASE_URL set');
  process.exit(1);
}

const sql = fs.readFileSync(
  path.join(repoRoot, 'supabase', 'migrations', '0001_init.sql'),
  'utf8',
);

let client;
try {
  client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
} catch (e) {
  if (process.env.DATABASE_URL && url !== process.env.DATABASE_URL) {
    console.warn('DIRECT_URL failed (', e.code, '), falling back to DATABASE_URL pooler');
    client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
  } else {
    throw e;
  }
}
console.log('Connected to', url.replace(/:[^@:]+@/, ':***@'));

const { rows: existing } = await client.query(`
  select table_name from information_schema.tables
  where table_schema = 'public' and table_name = 'accounts'
`);
if (existing.length) {
  console.log('public.accounts already exists — migration appears applied. Aborting.');
  await client.end();
  process.exit(0);
}

console.log(`Applying migration (${sql.length} bytes)...`);
await client.query(sql);
console.log('OK.');

const { rows: tables } = await client.query(`
  select table_name from information_schema.tables
  where table_schema = 'public'
  order by table_name
`);
console.log('public.* tables now:');
for (const t of tables) console.log('  -', t.table_name);

await client.end();
