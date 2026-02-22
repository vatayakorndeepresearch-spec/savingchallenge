-- Enable RLS and owner-based policies for production environments
-- owner should match either custom claim auth.jwt()->>'owner' or auth.uid()::text

alter table public.transactions enable row level security;
alter table public.budgets enable row level security;

drop policy if exists "transactions_select_own" on public.transactions;
drop policy if exists "transactions_insert_own" on public.transactions;
drop policy if exists "transactions_update_own" on public.transactions;
drop policy if exists "transactions_delete_own" on public.transactions;

create policy "transactions_select_own"
on public.transactions for select to authenticated
using (
  owner = coalesce(nullif(auth.jwt() ->> 'owner', ''), auth.uid()::text)
);

create policy "transactions_insert_own"
on public.transactions for insert to authenticated
with check (
  owner = coalesce(nullif(auth.jwt() ->> 'owner', ''), auth.uid()::text)
);

create policy "transactions_update_own"
on public.transactions for update to authenticated
using (
  owner = coalesce(nullif(auth.jwt() ->> 'owner', ''), auth.uid()::text)
)
with check (
  owner = coalesce(nullif(auth.jwt() ->> 'owner', ''), auth.uid()::text)
);

create policy "transactions_delete_own"
on public.transactions for delete to authenticated
using (
  owner = coalesce(nullif(auth.jwt() ->> 'owner', ''), auth.uid()::text)
);

drop policy if exists "budgets_select_own" on public.budgets;
drop policy if exists "budgets_insert_own" on public.budgets;
drop policy if exists "budgets_update_own" on public.budgets;
drop policy if exists "budgets_delete_own" on public.budgets;

create policy "budgets_select_own"
on public.budgets for select to authenticated
using (
  owner = coalesce(nullif(auth.jwt() ->> 'owner', ''), auth.uid()::text)
);

create policy "budgets_insert_own"
on public.budgets for insert to authenticated
with check (
  owner = coalesce(nullif(auth.jwt() ->> 'owner', ''), auth.uid()::text)
);

create policy "budgets_update_own"
on public.budgets for update to authenticated
using (
  owner = coalesce(nullif(auth.jwt() ->> 'owner', ''), auth.uid()::text)
)
with check (
  owner = coalesce(nullif(auth.jwt() ->> 'owner', ''), auth.uid()::text)
);

create policy "budgets_delete_own"
on public.budgets for delete to authenticated
using (
  owner = coalesce(nullif(auth.jwt() ->> 'owner', ''), auth.uid()::text)
);

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do update set public = false;

alter table storage.objects enable row level security;

drop policy if exists "Receipts Owner Access" on storage.objects;
drop policy if exists "Public Access" on storage.objects;

create policy "Receipts Owner Access"
on storage.objects for all to authenticated
using (
  bucket_id = 'receipts' and
  split_part(name, '/', 1) = coalesce(nullif(auth.jwt() ->> 'owner', ''), auth.uid()::text)
)
with check (
  bucket_id = 'receipts' and
  split_part(name, '/', 1) = coalesce(nullif(auth.jwt() ->> 'owner', ''), auth.uid()::text)
);
