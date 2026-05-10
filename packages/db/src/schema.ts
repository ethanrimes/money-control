import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// Accounts (Amex, BofA Checking, Capital One, ...). An account may be backed
// by:
//   - Teller (tellerAccountId + tellerEnrollmentId set)
//   - Plaid (plaidAccountId + plaidItemId set)
//   - Neither (seeded from xlsx, or manual entry)
// The two aggregators never co-own the same account row.
export const accounts = sqliteTable(
  "accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tellerAccountId: text("teller_account_id"),
    tellerEnrollmentId: integer("teller_enrollment_id"),
    plaidAccountId: text("plaid_account_id"),
    plaidItemId: integer("plaid_item_id"),
    name: text("name").notNull(),
    type: text("type", { enum: ["depository", "credit"] }).notNull(),
    subtype: text("subtype"), // e.g. checking, savings, credit_card — informational, not always set
    institution: text("institution"),
    lastFour: text("last_four"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (t) => ({
    tellerIdx: uniqueIndex("accounts_teller_idx").on(t.tellerAccountId),
    plaidIdx: uniqueIndex("accounts_plaid_idx").on(t.plaidAccountId),
    nameIdx: uniqueIndex("accounts_name_idx").on(t.name),
    enrollmentIdx: index("accounts_enrollment_idx").on(t.tellerEnrollmentId),
    plaidItemIdx: index("accounts_plaid_item_idx").on(t.plaidItemId),
  }),
);

// Categories form a 2-level hierarchy via parent_id (null parent = top-level).
export const categories = sqliteTable(
  "categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    parentId: integer("parent_id"),
    type: text("type", { enum: ["expense", "income", "transfer"] })
      .notNull()
      .default("expense"),
    color: text("color"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (t) => ({
    nameParentIdx: uniqueIndex("categories_name_parent_idx").on(t.name, t.parentId),
  }),
);

export const transactions = sqliteTable(
  "transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tellerTxnId: text("teller_txn_id"),
    plaidTransactionId: text("plaid_transaction_id"),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // ISO YYYY-MM-DD
    description: text("description").notNull(),
    rawDescription: text("raw_description").notNull(),
    amount: real("amount").notNull(), // negative = outflow, positive = inflow
    categoryId: integer("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    subcategoryId: integer("subcategory_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    source: text("source", { enum: ["excel", "teller", "plaid", "manual"] }).notNull(),
    sourceFile: text("source_file"),
    notes: text("notes"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (t) => ({
    tellerIdx: uniqueIndex("transactions_teller_idx").on(t.tellerTxnId),
    plaidIdx: uniqueIndex("transactions_plaid_idx").on(t.plaidTransactionId),
    dateIdx: index("transactions_date_idx").on(t.date),
    accountDateIdx: index("transactions_account_date_idx").on(t.accountId, t.date),
    categoryIdx: index("transactions_category_idx").on(t.categoryId),
  }),
);

// Description-based auto-categorization rules.
// `match_text` is the normalized description; matching is exact-first, then `contains`.
export const categorizationRules = sqliteTable(
  "categorization_rules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    matchText: text("match_text").notNull(),
    matchType: text("match_type", { enum: ["exact", "contains"] })
      .notNull()
      .default("exact"),
    categoryId: integer("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    subcategoryId: integer("subcategory_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    priority: integer("priority").notNull().default(100),
    hits: integer("hits").notNull().default(0),
    lastUsedAt: text("last_used_at"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (t) => ({
    matchIdx: uniqueIndex("rules_match_idx").on(t.matchText, t.matchType),
  }),
);

export const balances = sqliteTable(
  "balances",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    asOfDate: text("as_of_date").notNull(),
    current: real("current").notNull(),
    available: real("available"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (t) => ({
    accountDateIdx: uniqueIndex("balances_account_date_idx").on(t.accountId, t.asOfDate),
  }),
);

// Single-row table; latest row by effective_from wins.
export const budgetSettings = sqliteTable("budget_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  monthlySavingsTarget: real("monthly_savings_target").notNull(),
  effectiveFrom: text("effective_from").notNull(),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Persisted Teller enrollment access tokens.
export const tellerEnrollments = sqliteTable("teller_enrollments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  enrollmentId: text("enrollment_id").notNull().unique(),
  institutionName: text("institution_name").notNull(),
  accessToken: text("access_token").notNull(),
  userId: text("user_id"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Persisted Plaid Item access tokens. Each Item corresponds to one user-bank
// link (one institution = one Item). `cursor` is the last-seen sync cursor
// used by Plaid's /transactions/sync incremental API; null = full bootstrap
// on next sync.
export const plaidItems = sqliteTable("plaid_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: text("item_id").notNull().unique(),
  institutionName: text("institution_name").notNull(),
  institutionId: text("institution_id"),
  accessToken: text("access_token").notNull(),
  cursor: text("cursor"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

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
