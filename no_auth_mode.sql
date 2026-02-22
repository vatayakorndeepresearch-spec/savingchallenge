-- WARNING: No-auth mode (for local/personal usage only).
-- This script makes the app work without Supabase auth.
-- Do NOT use in production with sensitive data.

-- 1) Disable RLS on app tables so anon can read/write.
alter table if exists public.transactions disable row level security;
alter table if exists public.budgets disable row level security;

-- 2) Make receipts bucket public and allow anon full access to objects.
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', true)
on conflict (id) do update set public = true;

-- Some hosted roles cannot own storage.objects.
-- Keep no-auth mode for app tables working even when storage policy DDL is not permitted.
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
