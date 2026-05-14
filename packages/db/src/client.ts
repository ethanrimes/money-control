import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql as dsql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema.js";

type Schema = typeof schema;
export type Db = PostgresJsDatabase<Schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

let _client: ReturnType<typeof postgres> | null = null;
let _db: Db | null = null;

// Active per-request tx. When set, getDb() returns this scoped handle so all
// SELECT/UPDATE/DELETE go through the connection that has request.jwt.claims
// configured, and RLS auto-filters by the caller's user_id. INSERTs omit
// user_id and let the column DEFAULT (current_user_id()) supply it.
const requestCtx = new AsyncLocalStorage<{ tx: Tx; userId: string }>();

function getConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Point it at your Supabase Postgres (transaction pooler URL recommended for serverless).",
    );
  }
  return url;
}

function openClient(): ReturnType<typeof postgres> {
  if (_client) return _client;
  _client = postgres(getConnectionString(), {
    // Vercel functions are short-lived; keep the pool small and let
    // Supabase's PgBouncer handle real pooling.
    max: 1,
    idle_timeout: 20,
    // PgBouncer in transaction mode doesn't support prepared statements.
    prepare: false,
  });
  return _client;
}

// Inside a withUser() block this returns the per-request tx (RLS-scoped and
// connection-pinned). Otherwise returns the global unscoped handle. The
// unscoped handle is only safe for code paths that don't touch tenant data
// (eg ad-hoc admin scripts using the service_role connection string).
export function getDb(): Db {
  const ctx = requestCtx.getStore();
  if (ctx) return ctx.tx as unknown as Db;
  if (_db) return _db;
  _db = drizzle(openClient(), { schema });
  return _db;
}

// Returns the currently active user id, or null when outside a withUser()
// scope. Routes generally don't need this — INSERTs use the column DEFAULT
// (public.current_user_id()) which reads the same JWT claim.
export function currentUserId(): string | null {
  return requestCtx.getStore()?.userId ?? null;
}

// Opens a Drizzle transaction, sets request.jwt.claims so RLS policies (and
// the user_id column DEFAULT) see the caller as the given user, then runs fn
// with AsyncLocalStorage primed so getDb()/currentUserId() inside fn return
// the scoped handle. All queries inside fn share one connection.
export async function withUser<T>(
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const db = (_db ??= drizzle(openClient(), { schema }));
  return db.transaction(async (tx) => {
    await tx.execute(
      dsql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId })}, true)`,
    );
    return requestCtx.run({ tx, userId }, fn);
  });
}

// Raw postgres-js client for ad-hoc scripts / the migrator. Bypasses RLS.
export function getRawClient(): ReturnType<typeof postgres> {
  return openClient();
}

// Test-only: drop the cached singletons. Used by tests that need to reopen
// against a different DATABASE_URL.
export function __resetForTests(): void {
  if (_client) {
    try {
      _client.end({ timeout: 1 });
    } catch {
      /* ignore */
    }
  }
  _client = null;
  _db = null;
}

export { schema };
