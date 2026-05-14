-- MoneyControl multi-tenant schema for Supabase Postgres.
-- Every tenant table carries user_id and is locked down by RLS so a logged-in
-- user can only see/modify their own rows. The app uses a Postgres session
-- variable (request.jwt.claims) to identify the caller, which Supabase Auth
-- sets automatically for PostgREST and which the API layer mimics inside a
-- transaction when querying via Drizzle.

-- ---------------------------------------------------------------------------
-- Helper: current user id from the JWT claims set on the connection.
-- Returns NULL when no JWT is set (eg direct service_role connection).
-- ---------------------------------------------------------------------------
create or replace function public.current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
$$;

-- ---------------------------------------------------------------------------
-- accounts
-- ---------------------------------------------------------------------------
create table public.accounts (
  id                    bigserial primary key,
  user_id               uuid not null default public.current_user_id() references auth.users(id) on delete cascade,
  teller_account_id     text,
  teller_enrollment_id  bigint,
  plaid_account_id      text,
  plaid_item_id         bigint,
  name                  text not null,
  type                  text not null check (type in ('depository','credit')),
  subtype               text,
  institution           text,
  last_four             text,
  created_at            timestamptz not null default now()
);
create unique index accounts_teller_idx     on public.accounts (user_id, teller_account_id) where teller_account_id is not null;
create unique index accounts_plaid_idx      on public.accounts (user_id, plaid_account_id)  where plaid_account_id  is not null;
create unique index accounts_name_idx       on public.accounts (user_id, name);
create        index accounts_enrollment_idx on public.accounts (teller_enrollment_id);
create        index accounts_plaid_item_idx on public.accounts (plaid_item_id);

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------
create table public.categories (
  id          bigserial primary key,
  user_id               uuid not null default public.current_user_id() references auth.users(id) on delete cascade,
  name        text not null,
  parent_id   bigint references public.categories(id) on delete cascade,
  type        text not null default 'expense' check (type in ('expense','income','transfer')),
  color       text,
  created_at  timestamptz not null default now()
);
create unique index categories_name_parent_idx on public.categories (user_id, name, coalesce(parent_id, 0));

-- ---------------------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------------------
create table public.transactions (
  id                    bigserial primary key,
  user_id               uuid not null default public.current_user_id() references auth.users(id) on delete cascade,
  teller_txn_id         text,
  plaid_transaction_id  text,
  account_id            bigint not null references public.accounts(id) on delete cascade,
  date                  text not null,
  description           text not null,
  raw_description       text not null,
  amount                double precision not null,
  category_id           bigint references public.categories(id) on delete set null,
  subcategory_id        bigint references public.categories(id) on delete set null,
  source                text not null check (source in ('excel','teller','plaid','manual')),
  source_file           text,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index transactions_teller_idx       on public.transactions (user_id, teller_txn_id)        where teller_txn_id        is not null;
create unique index transactions_plaid_idx        on public.transactions (user_id, plaid_transaction_id) where plaid_transaction_id is not null;
create        index transactions_date_idx         on public.transactions (user_id, date);
create        index transactions_account_date_idx on public.transactions (account_id, date);
create        index transactions_category_idx     on public.transactions (category_id);

-- ---------------------------------------------------------------------------
-- categorization_rules
-- ---------------------------------------------------------------------------
create table public.categorization_rules (
  id              bigserial primary key,
  user_id               uuid not null default public.current_user_id() references auth.users(id) on delete cascade,
  match_text      text not null,
  match_type      text not null default 'exact' check (match_type in ('exact','contains')),
  category_id     bigint references public.categories(id) on delete set null,
  subcategory_id  bigint references public.categories(id) on delete set null,
  priority        integer not null default 100,
  hits            integer not null default 0,
  last_used_at    timestamptz,
  created_at      timestamptz not null default now()
);
create unique index rules_match_idx on public.categorization_rules (user_id, match_text, match_type);

-- ---------------------------------------------------------------------------
-- balances
-- ---------------------------------------------------------------------------
create table public.balances (
  id          bigserial primary key,
  user_id               uuid not null default public.current_user_id() references auth.users(id) on delete cascade,
  account_id  bigint not null references public.accounts(id) on delete cascade,
  as_of_date  text not null,
  current     double precision not null,
  available   double precision,
  created_at  timestamptz not null default now()
);
create unique index balances_account_date_idx on public.balances (account_id, as_of_date);

-- ---------------------------------------------------------------------------
-- budget_settings
-- ---------------------------------------------------------------------------
create table public.budget_settings (
  id                       bigserial primary key,
  user_id               uuid not null default public.current_user_id() references auth.users(id) on delete cascade,
  monthly_savings_target   double precision not null,
  effective_from           text not null,
  created_at               timestamptz not null default now()
);
create index budget_settings_user_idx on public.budget_settings (user_id, effective_from desc);

-- ---------------------------------------------------------------------------
-- teller_enrollments
-- ---------------------------------------------------------------------------
create table public.teller_enrollments (
  id                bigserial primary key,
  user_id               uuid not null default public.current_user_id() references auth.users(id) on delete cascade,
  enrollment_id     text not null,
  institution_name  text not null,
  access_token      text not null,
  teller_user_id    text,
  created_at        timestamptz not null default now()
);
create unique index teller_enrollments_user_idx on public.teller_enrollments (user_id, enrollment_id);

-- ---------------------------------------------------------------------------
-- plaid_items
-- ---------------------------------------------------------------------------
create table public.plaid_items (
  id                bigserial primary key,
  user_id               uuid not null default public.current_user_id() references auth.users(id) on delete cascade,
  item_id           text not null,
  institution_name  text not null,
  institution_id    text,
  access_token      text not null,
  cursor            text,
  created_at        timestamptz not null default now()
);
create unique index plaid_items_user_idx on public.plaid_items (user_id, item_id);

-- ---------------------------------------------------------------------------
-- Row Level Security: each user only sees their own rows.
-- Policies key off public.current_user_id() (which reads the JWT claim 'sub'
-- set on the connection). The service_role key bypasses RLS automatically.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  tenant_tables text[] := array[
    'accounts','categories','transactions','categorization_rules',
    'balances','budget_settings','teller_enrollments','plaid_items'
  ];
begin
  foreach t in array tenant_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format($f$
      create policy %1$I_select on public.%1$I
        for select using (user_id = public.current_user_id())
    $f$, t);
    execute format($f$
      create policy %1$I_insert on public.%1$I
        for insert with check (user_id = public.current_user_id())
    $f$, t);
    execute format($f$
      create policy %1$I_update on public.%1$I
        for update using (user_id = public.current_user_id())
                    with check (user_id = public.current_user_id())
    $f$, t);
    execute format($f$
      create policy %1$I_delete on public.%1$I
        for delete using (user_id = public.current_user_id())
    $f$, t);
  end loop;
end $$;
