// Drizzle's proxy migrator wants a "run" callback. We translate to node:sqlite.
import { migrate } from "drizzle-orm/sqlite-proxy/migrator";
import path from "node:path";
import { getDb, getDbPath, getRawSqlite } from "./client.js";

const db = getDb();
const sqlite = getRawSqlite();
const migrationsFolder = path.resolve(import.meta.dirname, "../drizzle");
console.log(`migrating ${getDbPath()} from ${migrationsFolder}`);

await migrate(
  db,
  async (queries) => {
    sqlite.exec("BEGIN");
    try {
      for (const q of queries) sqlite.exec(q);
      sqlite.exec("COMMIT");
    } catch (e) {
      sqlite.exec("ROLLBACK");
      throw e;
    }
  },
  { migrationsFolder },
);
console.log("done");
