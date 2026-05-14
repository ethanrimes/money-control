import { defineConfig } from "drizzle-kit";

// Drizzle Kit is only used at build/admin time to generate migrations.
// At runtime the app talks to Supabase via DATABASE_URL; the Supabase
// SQL migration in supabase/migrations/0001_init.sql is the source of
// truth for the live schema.
export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
