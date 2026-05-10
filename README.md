# MoneyControl

A personal-finance control plane: live visibility into income, debts, and spending across all your bank/credit accounts, with budget vs. historical-average tracking and per-category drill-downs. Web (Next.js) + mobile (Expo), single shared core.

## Layout

```
apps/
  web/        Next.js 15 dashboard
  mobile/     Expo cross-platform app
  server/     Hono local API — owns Teller mTLS client + SQLite
packages/
  core/       Domain logic (budget math, aggregations, types)
  db/         Drizzle schema, migrations, seed
teller/       (gitignored) Teller mTLS cert + key
data/         (gitignored) SQLite file lives here
```

## Quick start

```powershell
npm install

# DB
npm run db:generate    # create migration from schema
npm run db:migrate     # apply migrations
npm run db:seed        # load unified_statements_v2.xlsx

# Run
npm run dev:server     # http://localhost:3001
npm run dev:web        # http://localhost:3000
npm run dev:mobile     # Expo dev server
```

## Data model (sketch)

- `accounts` — Amex, BofA Checking, Capital One, etc. (depository | credit)
- `transactions` — date, account, description, amount, category, subcategory, source
- `categories` — hierarchical (Subscriptions > Software, etc.)
- `categorization_rules` — `description -> (category, subcategory)`. Editing a transaction's category creates/updates a rule, so similar future transactions auto-categorize.
- `balances` — point-in-time per-account
- `budget_settings` — monthly savings target

## Teller setup

The mTLS material in `teller/` is gitignored. To pull live transactions you also need access tokens, obtained via Teller Connect (handled in Phase 5).
