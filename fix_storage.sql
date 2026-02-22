-- 1. Create the bucket if it doesn't exist
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', true)
on conflict (id) do nothing;

-- 2. Set storage policy if permissions allow it.
do $$
begin
  begin
    alter table storage.objects enable row level security;
  exception
    when insufficient_privilege then
      raise notice 'Skipping ALTER TABLE storage.objects (must be table owner).';
  end;

  -- This is safe ONLY because this is a personal app with no sensitive data.
  begin
    drop policy if exists "Public Access" on storage.objects;

    create policy "Public Access"
    on storage.objects for all
    using ( bucket_id = 'receipts' )
    with check ( bucket_id = 'receipts' );
  exception
    when insufficient_privilege then
      raise notice 'Skipping storage.objects policy DDL (must be table owner).';
  end;
end
$$;
