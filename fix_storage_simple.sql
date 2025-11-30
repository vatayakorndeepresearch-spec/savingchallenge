-- 1. Create the bucket 'receipts' (if it doesn't exist)
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', true)
on conflict (id) do nothing;

-- 2. Create the policy (Drop first to avoid errors if it exists)
drop policy if exists "Public Access" on storage.objects;

create policy "Public Access"
on storage.objects for all
using ( bucket_id = 'receipts' )
with check ( bucket_id = 'receipts' );
