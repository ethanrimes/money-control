// API-facing shapes. Mirrors @moneycontrol/db types but decoupled so frontends
// don't pull better-sqlite3 into their bundles.

export type AccountType = "depository" | "credit";
export type TransactionSource = "excel" | "teller" | "manual";
export type CategoryType = "expense" | "income" | "transfer";

export interface AccountDTO {
  id: number;
  name: string;
  type: AccountType;
  institution: string | null;
  lastFour: string | null;
}

export interface CategoryDTO {
  id: number;
  name: string;
  parentId: number | null;
  type: CategoryType;
  color: string | null;
}

export interface TransactionDTO {
  id: number;
  accountId: number;
  date: string; // YYYY-MM-DD
  description: string;
  amount: number;
  categoryId: number | null;
  subcategoryId: number | null;
  source: TransactionSource;
  notes: string | null;
}

export interface BalanceDTO {
  accountId: number;
  asOfDate: string;
  current: number;
  available: number | null;
}

export interface NetCashSnapshot {
  totalDepository: number;
  totalCredit: number; // positive number = total debt outstanding
  netCash: number;     // depository - credit
  perAccount: Array<{ accountId: number; name: string; type: AccountType; balance: number }>;
}
