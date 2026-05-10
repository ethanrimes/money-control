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

Two pieces are needed before the "Link account" button in the dashboard does anything:

1. **mTLS material** — drop `certificate.pem` and `private_key.pem` from your Teller dashboard into `./teller/` (gitignored). The server uses these on every API call.
2. **Application ID** — sign up at [teller.io](https://teller.io), copy your Application ID, set `TELLER_APP_ID=app_...` in `.env`. Restart the server.

Once both are set, the dashboard's "Linked institutions" card will let you launch Teller Connect, pick a bank/credit card, and the resulting access token is persisted server-side. Hit Refresh to pull balances + transactions.
