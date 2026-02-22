-- Baseline schema (aligned with current app code).
-- For local/no-auth usage, run no_auth_mode.sql after this file.

-- 1) App tables
create table if not exists public.transactions (
  id bigserial primary key,
  type text not null check (type in ('income', 'expense')),
  amount numeric(12,2) not null check (amount >= 0),
  jar_key text check (jar_key in ('expense', 'saving', 'investment', 'debt')),
  category text not null,
  note text,
  ocr_raw_text text,
  ocr_confidence numeric(5,2) check (ocr_confidence is null or (ocr_confidence >= 0 and ocr_confidence <= 100)),
  image_path text,
  batch_id text,
  source_file_name text,
  date date not null,
  created_at timestamptz not null default now(),
  owner text not null default 'bear' check (length(trim(owner)) > 0)
);

create table if not exists public.budgets (
  id bigserial primary key,
  year int not null,
  month int not null check (month between 1 and 12),
  amount numeric(12,2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  owner text not null default 'bear' check (length(trim(owner)) > 0),
  unique (year, month, owner)
);

-- 2) RLS policies (production-safe)
-- owner must match either:
-- - auth.jwt()->>'owner' (custom claim), or
-- - auth.uid()::text (default Supabase user id)
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;

drop policy if exists "transactions_select_own" on public.transactions;
drop policy if exists "transactions_insert_own" on public.transactions;
drop policy if exists "transactions_update_own" on public.transactions;
drop policy if exists "transactions_delete_own" on public.transactions;

create policy "transactions_select_own"
on public.transactions for select to authenticated
using (owner = coalesce(nullif(auth.jwt() ->> 'owner', ''), auth.uid()::text));

create policy "transactions_insert_own"
on public.transactions for insert to authenticated
with check (owner = coalesce(nullif(auth.jwt() ->> 'owner', ''), auth.uid()::text));

create policy "transactions_update_own"
on public.transactions for update to authenticated
using (owner = coalesce(nullif(auth.jwt() ->> 'owner', ''), auth.uid()::text))
with check (owner = coalesce(nullif(auth.jwt() ->> 'owner', ''), auth.uid()::text));

create policy "transactions_delete_own"
on public.transactions for delete to authenticated
using (owner = coalesce(nullif(auth.jwt() ->> 'owner', ''), auth.uid()::text));

drop policy if exists "budgets_select_own" on public.budgets;
drop policy if exists "budgets_insert_own" on public.budgets;
drop policy if exists "budgets_update_own" on public.budgets;
drop policy if exists "budgets_delete_own" on public.budgets;

create policy "budgets_select_own"
on public.budgets for select to authenticated
using (owner = coalesce(nullif(auth.jwt() ->> 'owner', ''), auth.uid()::text));

create policy "budgets_insert_own"
on public.budgets for insert to authenticated
with check (owner = coalesce(nullif(auth.jwt() ->> 'owner', ''), auth.uid()::text));

create policy "budgets_update_own"
on public.budgets for update to authenticated
using (owner = coalesce(nullif(auth.jwt() ->> 'owner', ''), auth.uid()::text))
with check (owner = coalesce(nullif(auth.jwt() ->> 'owner', ''), auth.uid()::text));

create policy "budgets_delete_own"
on public.budgets for delete to authenticated
using (owner = coalesce(nullif(auth.jwt() ->> 'owner', ''), auth.uid()::text));

-- 3) Storage (bucket: receipts)
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do update set public = false;

alter table storage.objects enable row level security;

drop policy if exists "Receipts Owner Access" on storage.objects;
drop policy if exists "Public Access" on storage.objects;

create policy "Receipts Owner Access"
on storage.objects for all to authenticated
using (
  bucket_id = 'receipts'
  and split_part(name, '/', 1) = coalesce(nullif(auth.jwt() ->> 'owner', ''), auth.uid()::text)
)
with check (
  bucket_id = 'receipts'
  and split_part(name, '/', 1) = coalesce(nullif(auth.jwt() ->> 'owner', ''), auth.uid()::text)
);

-- 4) Indices
create index if not exists idx_transactions_owner on public.transactions(owner);
create index if not exists idx_transactions_date on public.transactions(date);
create index if not exists idx_transactions_owner_date on public.transactions(owner, date);
create index if not exists idx_transactions_owner_date_jar on public.transactions(owner, date, jar_key);
create index if not exists idx_transactions_batch_id on public.transactions(batch_id);
create index if not exists idx_budgets_owner_year_month on public.budgets(owner, year, month);
