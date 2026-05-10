// Typed wrapper around fetch -> the @moneycontrol/server. All endpoints are
// read-mostly except /transactions PATCH, /budget PUT, and /teller/sync POST.

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${path}: ${text || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// ---------- Types ----------

export interface AccountRow {
  id: number;
  name: string;
  type: "depository" | "credit";
  institution: string | null;
  lastFour: string | null;
  tellerAccountId: string | null;
  latestBalance: number | null;
  latestBalanceDate: string | null;
}

export interface TransactionRow {
  id: number;
  date: string;
  description: string;
  amount: number;
  accountId: number;
  accountName: string | null;
  categoryId: number | null;
  categoryName: string | null;
  subcategoryId: number | null;
  subcategoryName: string | null;
  source: "excel" | "teller" | "manual";
  notes: string | null;
}

export interface CategoryNode {
  id: number;
  name: string;
  parentId: number | null;
  type: "expense" | "income" | "transfer";
  color: string | null;
  subcategories: Array<{
    id: number;
    name: string;
    parentId: number | null;
    type: "expense" | "income" | "transfer";
    color: string | null;
  }>;
}

export interface NetCash {
  totalDepository: number;
  totalCredit: number;
  netCash: number;
  perAccount: Array<{
    accountId: number;
    name: string;
    type: "depository" | "credit";
    balance: number;
  }>;
}

export interface SpendSeriesPoint {
  day: number;
  actual: number | null;
  budget: number;
  historicalAvg: number;
}

export interface SpendSeries {
  month: string;
  monthlyBudget: number;
  trailingMonthlyIncome: number;
  monthlySavingsTarget: number;
  points: SpendSeriesPoint[];
}

export interface ByCategoryRow {
  categoryId: number | null;
  categoryName: string;
  currentSpend: number;
  historicalAverage: number;
  transactionCount: number;
}

export interface Stats {
  mtdSpend: number;
  mtdIncome: number;
  mtdTransactionCount: number;
  asOf: string;
}

export interface BudgetSettings {
  id: number;
  monthlySavingsTarget: number;
  effectiveFrom: string;
}

export interface SyncResult {
  enrollments: Array<{
    id: number;
    institutionName: string;
    accounts: number;
    balances: number;
    newTransactions: number;
    error?: string;
  }>;
  totals: { accounts: number; balances: number; transactions: number };
  syncedAt?: string;
}

// ---------- API surface ----------

export const api = {
  health: () => request<{ ok: boolean }>("/health"),

  accounts: () => request<AccountRow[]>("/accounts"),
  categories: () => request<CategoryNode[]>("/categories"),

  transactions: (q: {
    from?: string;
    to?: string;
    accountId?: number;
    categoryId?: number;
    limit?: number;
    offset?: number;
  } = {}) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
    const qs = sp.toString();
    return request<TransactionRow[]>(`/transactions${qs ? `?${qs}` : ""}`);
  },
  patchTransaction: (id: number, body: { categoryId?: number | null; subcategoryId?: number | null; notes?: string | null }) =>
    request<TransactionRow>(`/transactions/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

  budget: () => request<BudgetSettings | null>("/budget"),
  putBudget: (body: { monthlySavingsTarget: number; effectiveFrom?: string }) =>
    request<BudgetSettings>("/budget", { method: "PUT", body: JSON.stringify(body) }),

  netCash: () => request<NetCash>("/summary/net-cash"),
  spendSeries: (month?: string) =>
    request<SpendSeries>(`/summary/spend-series${month ? `?month=${month}` : ""}`),
  byCategory: (month?: string) =>
    request<{ month: string; categories: ByCategoryRow[] }>(`/summary/by-category${month ? `?month=${month}` : ""}`),
  stats: () => request<Stats>("/summary/stats"),

  sync: () => request<SyncResult>("/teller/sync", { method: "POST" }),
};

// ---------- Helpers ----------

export function fmtUsd(n: number, opts?: { sign?: boolean }): string {
  const abs = Math.abs(n);
  const fmt = abs >= 1000
    ? abs.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = n < 0 ? "−" : opts?.sign ? "+" : "";
  return `${sign}$${fmt}`;
}

export function currentMonth(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
