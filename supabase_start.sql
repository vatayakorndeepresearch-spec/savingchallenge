-- Supabase bootstrap script for this project (quick start, no-auth mode).
-- Run this whole file once in Supabase SQL Editor.
-- Safe to re-run: uses IF NOT EXISTS / ON CONFLICT where possible.

-- 1) App tables
create table if not exists public.transactions (
  id bigserial primary key,
  type text not null check (type in ('income', 'expense')),
  amount numeric(12,2) not null check (amount >= 0),
  jar_key text check (jar_key in ('expense', 'saving', 'investment', 'debt')),
  category text not null,
  note text,
  ocr_raw_text text,
  ocr_confidence numeric(5,2) check (
    ocr_confidence is null or (ocr_confidence >= 0 and ocr_confidence <= 100)
  ),
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

-- 2) Indexes
create index if not exists idx_transactions_owner on public.transactions(owner);
create index if not exists idx_transactions_date on public.transactions(date);
create index if not exists idx_transactions_owner_date on public.transactions(owner, date);
create index if not exists idx_transactions_owner_date_jar on public.transactions(owner, date, jar_key);
create index if not exists idx_transactions_batch_id on public.transactions(batch_id);
create index if not exists idx_budgets_owner_year_month on public.budgets(owner, year, month);

-- 3) No-auth mode for this app
-- This app can run without Supabase login; owner is app-level ('bear'/'rabbit').
alter table if exists public.transactions disable row level security;
alter table if exists public.budgets disable row level security;

-- 4) Storage bucket
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', true)
on conflict (id) do update set public = true;

-- 5) Storage policy (guarded for hosted roles that cannot own storage.objects)
do $$
begin
  begin
    alter table storage.objects enable row level security;
  exception
    when insufficient_privilege then
      raise notice 'Skipping ALTER TABLE storage.objects (must be table owner).';
  end;

  begin
    drop policy if exists "Receipts Owner Access" on storage.objects;
    drop policy if exists "Public Access" on storage.objects;

    create policy "Public Access"
    on storage.objects for all
    using (bucket_id = 'receipts')
    with check (bucket_id = 'receipts');
  exception
    when insufficient_privilege then
      raise notice 'Skipping storage.objects policy DDL (must be table owner).';
  end;
end
$$;

-- 6) Optional verification
-- select to_regclass('public.transactions') as transactions_table;
-- select to_regclass('public.budgets') as budgets_table;
-- select id, public from storage.buckets where id = 'receipts';
