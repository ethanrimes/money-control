// Postgres migrations are applied via supabase/migrations/0001_init.sql,
// not via drizzle-kit's migrator. This entry point now just runs that file
// against DATABASE_URL (or DIRECT_URL) for ad-hoc use.
import fs from "node:fs";
import path from "node:path";
import { getRawClient } from "./client.js";

const sqlFile = process.env.MIGRATION_SQL
  ?? path.resolve(import.meta.dirname, "../../../supabase/migrations/0001_init.sql");

const sql = getRawClient();
const text = fs.readFileSync(sqlFile, "utf8");
console.log(`applying ${sqlFile}`);
await sql.unsafe(text);
console.log("done");
await sql.end({ timeout: 5 });
