// Inspect the local SQLite DB so we know exactly what to migrate.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const db = new Database(path.join(repoRoot, 'data', 'moneycontrol.db'), { readonly: true });

const tables = db.prepare(`select name from sqlite_master where type='table' order by name`).all();
for (const { name } of tables) {
  if (name.startsWith('sqlite_')) continue;
  const cols = db.prepare(`pragma table_info(${name})`).all();
  const { c } = db.prepare(`select count(*) as c from ${name}`).get();
  console.log(`\n=== ${name} (${c} rows) ===`);
  for (const col of cols) console.log(`  ${col.name.padEnd(28)} ${col.type}${col.notnull ? ' NOT NULL' : ''}${col.pk ? ' PK' : ''}`);
}
db.close();
