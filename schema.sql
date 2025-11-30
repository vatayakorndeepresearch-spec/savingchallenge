-- 1. Create transactions table
create table if not exists public.transactions (
  id bigserial primary key,
  type text not null check (type in ('income','expense')),
  amount numeric(12,2) not null check (amount >= 0),
  category text not null,
  note text,
  image_path text,
  date date not null,
  created_at timestamptz default now(),
  owner text default 'bear' -- Added owner column
);

-- 2. Create budgets table
create table if not exists public.budgets (
  id bigserial primary key,
  year int not null,
  month int not null check (month between 1 and 12),
  amount numeric(12,2) not null,
  created_at timestamptz default now(),
  owner text default 'bear', -- Added owner column
  unique (year, month, owner) -- Unique constraint per user per month
);

-- 3. Disable RLS for simple personal use (Tables)
alter table public.transactions disable row level security;
alter table public.budgets disable row level security;

-- 4. Storage Setup
-- Create bucket 'receipts'
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', true)
on conflict (id) do nothing;

-- Enable RLS on storage.objects
alter table storage.objects enable row level security;

-- Create public access policy for storage
drop policy if exists "Public Access" on storage.objects;
create policy "Public Access"
on storage.objects for all
using ( bucket_id = 'receipts' )
with check ( bucket_id = 'receipts' );

-- 5. Indices for Performance
create index if not exists idx_transactions_owner on public.transactions(owner);
create index if not exists idx_transactions_date on public.transactions(date);
create index if not exists idx_transactions_owner_date on public.transactions(owner, date);
create index if not exists idx_budgets_owner_year_month on public.budgets(owner, year, month);
