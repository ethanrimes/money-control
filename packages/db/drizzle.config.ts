import { defineConfig } from "drizzle-kit";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../..");
const dbPath = process.env.DATABASE_FILE ?? path.join(repoRoot, "data", "moneycontrol.db");

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: { url: dbPath },
  strict: true,
  verbose: true,
});
