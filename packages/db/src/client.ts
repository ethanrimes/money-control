import { DatabaseSync, type StatementResultingChanges } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import fs from "node:fs";
import path from "node:path";
import { aliasSelectColumns } from "./sql-rewrite.js";
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

  if (method === "run") {
    const stmt = sqlite.prepare(sql);
    const info: StatementResultingChanges = stmt.run(...(params as never[]));
    return { rows: [[Number(info.lastInsertRowid), info.changes]] };
  }

  // SELECT path: rewrite outermost SELECT to add positional column aliases so
  // duplicate column names (e.g. multiple joined tables with `name`) don't
  // collapse in node:sqlite's row-as-object representation.
  const aliased = aliasSelectColumns(sql);
  if (process.env.DRIZZLE_DEBUG) console.error("[drizzle-proxy]", method, "\n  in:", sql, "\n  out:", aliased);
  const stmt = sqlite.prepare(aliased);
  const objs = stmt.all(...(params as never[])) as Array<Record<string, unknown>>;
  if (objs.length === 0) return { rows: [] };

  // Sort keys by their _cN ordinal so values come back in SELECT order even
  // if the runtime emits them in some other ordering.
  const keys = Object.keys(objs[0]!).sort((a, b) => {
    const ai = parseAliasOrdinal(a);
    const bi = parseAliasOrdinal(b);
    return ai - bi;
  });
  const rows = objs.map((o) => keys.map((k) => o[k]));

  if (method === "get") return { rows: rows[0] ?? [] };
  return { rows };
}

function parseAliasOrdinal(key: string): number {
  const m = key.match(/^_c(\d+)$/);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
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

// Test-only: drop the cached singletons so the next getDb() call re-reads
// process.env.DATABASE_FILE. Used by `freshDb()` in tests so each test gets
// an isolated SQLite file.
export function __resetForTests(): void {
  if (_sqlite) {
    try { _sqlite.close(); } catch { /* ignore */ }
  }
  _sqlite = null;
  _db = null;
}

export { schema };
