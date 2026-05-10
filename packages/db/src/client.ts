import { DatabaseSync, type StatementResultingChanges } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema.js";

let _sqlite: DatabaseSync | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDbPath(): string {
  if (process.env.DATABASE_FILE) return process.env.DATABASE_FILE;
  const repoRoot = path.resolve(import.meta.dirname, "../../..");
  return path.join(repoRoot, "data", "moneycontrol.db");
}

function openSqlite(): DatabaseSync {
  if (_sqlite) return _sqlite;
  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new DatabaseSync(dbPath);
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");
  _sqlite = sqlite;
  return sqlite;
}

// Drizzle's sqlite-proxy adapter: we hand back row arrays from any SQL executor.
// node:sqlite returns row objects; convert them to arrays in column order.
async function executeQuery(sql: string, params: unknown[], method: "all" | "run" | "get" | "values") {
  const sqlite = openSqlite();
  const stmt = sqlite.prepare(sql);

  if (method === "run") {
    const info: StatementResultingChanges = stmt.run(...(params as never[]));
    return { rows: [[Number(info.lastInsertRowid), info.changes]] };
  }

  // .all() returns [{col: val, ...}, ...]; sqlite-proxy expects rows as arrays.
  const objs = stmt.all(...(params as never[])) as Array<Record<string, unknown>>;
  if (objs.length === 0) return { rows: [] };

  const cols = Object.keys(objs[0]!);
  const rows = objs.map((o) => cols.map((c) => o[c]));

  if (method === "get") return { rows: rows[0] ?? [] };
  return { rows };
}

export function getDb() {
  if (_db) return _db;
  _db = drizzle(executeQuery, { schema });
  return _db;
}

// Raw SQL access for the migrator and for ad-hoc scripts.
export function getRawSqlite(): DatabaseSync {
  return openSqlite();
}

export { schema };
