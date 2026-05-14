import { sql } from "drizzle-orm";
import {
  bigserial,
  bigint,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// All tables are multi-tenant: every row carries the userId of the owner and
// is gated by Postgres RLS policies. The app sets request.jwt.claims on each
// connection so SELECT/UPDATE/DELETE see only the caller's rows; INSERTs must
// supply userId explicitly (RLS WITH CHECK enforces it matches the caller).

// Accounts (Amex, BofA Checking, Capital One, ...). An account may be backed
// by:
//   - Teller (tellerAccountId + tellerEnrollmentId set)
//   - Plaid (plaidAccountId + plaidItemId set)
//   - Neither (seeded from xlsx, or manual entry)
// The two aggregators never co-own the same account row.
export const accounts = pgTable(
  "accounts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").notNull().default(sql`(current_setting('request.jwt.claims', true)::json->>'sub')::uuid`),
    tellerAccountId: text("teller_account_id"),
    tellerEnrollmentId: bigint("teller_enrollment_id", { mode: "number" }),
    plaidAccountId: text("plaid_account_id"),
    plaidItemId: bigint("plaid_item_id", { mode: "number" }),
    name: text("name").notNull(),
    type: text("type", { enum: ["depository", "credit"] }).notNull(),
    subtype: text("subtype"), // e.g. checking, savings, credit_card — informational, not always set
    institution: text("institution"),
    lastFour: text("last_four"),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  },
  (t) => ({
    tellerIdx: uniqueIndex("accounts_teller_idx").on(t.userId, t.tellerAccountId),
    plaidIdx: uniqueIndex("accounts_plaid_idx").on(t.userId, t.plaidAccountId),
    nameIdx: uniqueIndex("accounts_name_idx").on(t.userId, t.name),
    enrollmentIdx: index("accounts_enrollment_idx").on(t.tellerEnrollmentId),
    plaidItemIdx: index("accounts_plaid_item_idx").on(t.plaidItemId),
  }),
);

// Categories form a 2-level hierarchy via parent_id (null parent = top-level).
export const categories = pgTable(
  "categories",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").notNull().default(sql`(current_setting('request.jwt.claims', true)::json->>'sub')::uuid`),
    name: text("name").notNull(),
    parentId: bigint("parent_id", { mode: "number" }),
    type: text("type", { enum: ["expense", "income", "transfer"] })
      .notNull()
      .default("expense"),
    color: text("color"),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  },
  (t) => ({
    nameParentIdx: uniqueIndex("categories_name_parent_idx").on(t.userId, t.name, t.parentId),
  }),
);

export const transactions = pgTable(
  "transactions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").notNull().default(sql`(current_setting('request.jwt.claims', true)::json->>'sub')::uuid`),
    tellerTxnId: text("teller_txn_id"),
    plaidTransactionId: text("plaid_transaction_id"),
    accountId: bigint("account_id", { mode: "number" })
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // ISO YYYY-MM-DD
    description: text("description").notNull(),
    rawDescription: text("raw_description").notNull(),
    amount: doublePrecision("amount").notNull(), // negative = outflow, positive = inflow
    categoryId: bigint("category_id", { mode: "number" }).references(() => categories.id, {
      onDelete: "set null",
    }),
    subcategoryId: bigint("subcategory_id", { mode: "number" }).references(() => categories.id, {
      onDelete: "set null",
    }),
    source: text("source", { enum: ["excel", "teller", "plaid", "manual"] }).notNull(),
    sourceFile: text("source_file"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  },
  (t) => ({
    tellerIdx: uniqueIndex("transactions_teller_idx").on(t.userId, t.tellerTxnId),
    plaidIdx: uniqueIndex("transactions_plaid_idx").on(t.userId, t.plaidTransactionId),
    dateIdx: index("transactions_date_idx").on(t.userId, t.date),
    accountDateIdx: index("transactions_account_date_idx").on(t.accountId, t.date),
    categoryIdx: index("transactions_category_idx").on(t.categoryId),
  }),
);

// Description-based auto-categorization rules.
// `match_text` is the normalized description; matching is exact-first, then `contains`.
export const categorizationRules = pgTable(
  "categorization_rules",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").notNull().default(sql`(current_setting('request.jwt.claims', true)::json->>'sub')::uuid`),
    matchText: text("match_text").notNull(),
    matchType: text("match_type", { enum: ["exact", "contains"] })
      .notNull()
      .default("exact"),
    categoryId: bigint("category_id", { mode: "number" }).references(() => categories.id, {
      onDelete: "set null",
    }),
    subcategoryId: bigint("subcategory_id", { mode: "number" }).references(() => categories.id, {
      onDelete: "set null",
    }),
    priority: integer("priority").notNull().default(100),
    hits: integer("hits").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  },
  (t) => ({
    matchIdx: uniqueIndex("rules_match_idx").on(t.userId, t.matchText, t.matchType),
  }),
);

export const balances = pgTable(
  "balances",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").notNull().default(sql`(current_setting('request.jwt.claims', true)::json->>'sub')::uuid`),
    accountId: bigint("account_id", { mode: "number" })
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    asOfDate: text("as_of_date").notNull(),
    current: doublePrecision("current").notNull(),
    available: doublePrecision("available"),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  },
  (t) => ({
    accountDateIdx: uniqueIndex("balances_account_date_idx").on(t.accountId, t.asOfDate),
  }),
);

// Per-user; latest row by effectiveFrom wins.
export const budgetSettings = pgTable("budget_settings", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: uuid("user_id").notNull().default(sql`(current_setting('request.jwt.claims', true)::json->>'sub')::uuid`),
  monthlySavingsTarget: doublePrecision("monthly_savings_target").notNull(),
  effectiveFrom: text("effective_from").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
});

// Persisted Teller enrollment access tokens.
// NOTE: Teller's own user id is stored as tellerUserId to avoid colliding with
// our owner userId column.
export const tellerEnrollments = pgTable(
  "teller_enrollments",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").notNull().default(sql`(current_setting('request.jwt.claims', true)::json->>'sub')::uuid`),
    enrollmentId: text("enrollment_id").notNull(),
    institutionName: text("institution_name").notNull(),
    accessToken: text("access_token").notNull(),
    tellerUserId: text("teller_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  },
  (t) => ({
    userEnrollmentIdx: uniqueIndex("teller_enrollments_user_idx").on(t.userId, t.enrollmentId),
  }),
);

// Persisted Plaid Item access tokens. Each Item corresponds to one user-bank
// link (one institution = one Item). `cursor` is the last-seen sync cursor
// used by Plaid's /transactions/sync incremental API; null = full bootstrap
// on next sync.
export const plaidItems = pgTable(
  "plaid_items",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").notNull().default(sql`(current_setting('request.jwt.claims', true)::json->>'sub')::uuid`),
    itemId: text("item_id").notNull(),
    institutionName: text("institution_name").notNull(),
    institutionId: text("institution_id"),
    accessToken: text("access_token").notNull(),
    cursor: text("cursor"),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  },
  (t) => ({
    userItemIdx: uniqueIndex("plaid_items_user_idx").on(t.userId, t.itemId),
  }),
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type CategorizationRule = typeof categorizationRules.$inferSelect;
export type NewCategorizationRule = typeof categorizationRules.$inferInsert;
export type Balance = typeof balances.$inferSelect;
export type NewBalance = typeof balances.$inferInsert;
export type BudgetSettings = typeof budgetSettings.$inferSelect;
export type TellerEnrollment = typeof tellerEnrollments.$inferSelect;
export type PlaidItem = typeof plaidItems.$inferSelect;
export type NewPlaidItem = typeof plaidItems.$inferInsert;
