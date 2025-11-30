-- 1. Create the bucket if it doesn't exist
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', true)
on conflict (id) do nothing;

-- 2. Enable RLS on storage.objects (standard practice in Supabase)
alter table storage.objects enable row level security;

-- 3. Create a policy to allow ALL operations (select, insert, update, delete) for everyone (anon)
-- This is safe ONLY because this is a personal app with no sensitive data
drop policy if exists "Public Access" on storage.objects;

create policy "Public Access"
on storage.objects for all
using ( bucket_id = 'receipts' )
with check ( bucket_id = 'receipts' );
